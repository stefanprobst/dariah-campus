/**
 * Converts the Keystatic content in `content/` into the CMS format.
 *
 * Usage: `tsx ./scripts/cms/migrate.ts [--output <dir>] [--copy-media]`
 *
 * - Every entry is converted and validated against `lib/cms/schema.ts`; any problem fails the run, so it can run
 *   repeatedly against live content until the cutover.
 * - Entry IDs are derived from collection and slug, and media IDs from file contents, so repeated runs produce the same
 *   output.
 * - Referenced assets in `public/assets/content` become media entries. `--copy-media` also links or copies the files into
 *   `<output>/media-files`, laid out as the filesystem media store expects; uploading to S3 is a separate step.
 * - Entries marked `draft: true` are written to `<output>/drafts`, to be added to a change set at cutover.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { log } from "@acdh-oeaw/lib";
import { withGfm } from "@acdh-oeaw/mdx-lib";
import { type StoredEntry, createJsonEntryFormat, getSingletonIdentity, getUploadKey } from "@stefanprobst/cms/core";
import type { BlockNode, ComponentNode, InlineNode, RichTextRoot } from "@stefanprobst/cms/rich-text";
import {
	type ConversionHelpers,
	type MdastNode,
	type MdxJsxElement,
	fromMdast,
} from "@stefanprobst/cms/rich-text/mdast";
import { type AnyComponent, type AnyField, validateData } from "@stefanprobst/cms/schema";
import { imageSize } from "image-size";
import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { parse as parseYaml } from "yaml";

import { linkTargets } from "#/lib/cms/components.ts";
import { maxMediaSize, mediaContentTypes } from "#/lib/cms/media.ts";
import { schema } from "#/lib/cms/schema.ts";

// -------------------------------------------------------------------------------------------------------------
// Setup
// -------------------------------------------------------------------------------------------------------------

const { values: args } = parseArgs({
	options: {
		output: { type: "string", default: ".cms-migration" },
		"copy-media": { type: "boolean", default: false },
	},
});

const root = process.cwd();
const contentDirectory = path.join(root, "content", "en");
const publicDirectory = path.join(root, "public");
const outputDirectory = path.resolve(root, args.output);
const locale = "en";

const format = createJsonEntryFormat({ schema });
/** The gfm subset of the mdx pipeline: no autolinks for bare urls. */
const processor = remark().use(remarkFrontmatter).use(remarkMdx).use(withGfm, {});

const contentTypes: Record<string, string> = {
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
	mp4: "video/mp4",
	wav: "audio/wav",
	pdf: "application/pdf",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	zip: "application/zip",
	rmd: "text/markdown",
};

// -------------------------------------------------------------------------------------------------------------
// Report
// -------------------------------------------------------------------------------------------------------------

interface Problem {
	entry: string;
	message: string;
}

const problems: Array<Problem> = [];
const adjustments: Array<Problem> = [];

class ConversionError extends Error {}

function adjust(entry: string, message: string): void {
	adjustments.push({ entry, message });
}

/** One-off content errors, fixed explicitly. Keyed by `collection/slug`. */
const attributeRenames: Record<string, Record<string, Record<string, string>>> = {
	/** The thumbnail's `src` attribute lost its name. */
	"resources-hosted/data-protection-in-research-practice-a-tutorial": { VideoCard: { v: "src" } },
};

const slugFixes: Record<string, string> = {
	"modeling-dictionaries-in-tei-lex-0)": "modeling-dictionaries-in-tei-lex-0",
};

// -------------------------------------------------------------------------------------------------------------
// Identifiers
// -------------------------------------------------------------------------------------------------------------

/** A UUID (version 8, custom) derived from a name, so repeated runs assign the same IDs. */
function createStableId(name: string): string {
	const hex = createHash("sha256").update(name).digest("hex").slice(0, 32).split("");
	hex[12] = "8";
	hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
	const value = hex.join("");
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function getEntryId(collection: string, slug: string): string {
	return createStableId(`${collection}/${slug}`);
}

/** Slugs of every entry, to check relationships. Filled before converting. */
const knownSlugs = new Map<string, Set<string>>();

// -------------------------------------------------------------------------------------------------------------
// Media
// -------------------------------------------------------------------------------------------------------------

interface MediaAsset {
	id: string;
	slug: string;
	file: string;
	filename: string;
	sha256: string;
	size: number;
	contentType: string;
	key: string;
	width: number | null;
	height: number | null;
	usedBy: Set<string>;
}

const assetsByFile = new Map<string, MediaAsset>();
const assetsByHash = new Map<string, MediaAsset>();

/** The file of an asset url, with fixes for misspelt paths. */
function resolveAssetFile(url: string, entry: string | null): string {
	if (!url.startsWith("/assets/")) {
		throw new ConversionError(`Asset "${url}" is not a local asset.`);
	}
	let file = path.join(publicDirectory, url);
	if (!existsSync(file)) {
		file = path.join(publicDirectory, decodeURI(url));
	}
	if (existsSync(file)) {
		return file;
	}
	/** A few download paths lost the dot before the extension, e.g. `slides-pdf`. */
	const fixed = file.replace(/-(?<extension>[a-z\d]{2,4})$/, ".$<extension>");
	if (fixed !== file && existsSync(fixed)) {
		if (entry != null) {
			adjust(entry, `Asset "${url}" → "${path.basename(fixed)}".`);
		}
		return fixed;
	}
	throw new ConversionError(`Asset "${url}" does not exist.`);
}

/** Reads, hashes and measures a file once. */
async function loadAsset(file: string): Promise<void> {
	if (assetsByFile.has(file)) {
		return;
	}
	const bytes = await fs.readFile(file);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const existing = assetsByHash.get(sha256);
	if (existing != null) {
		assetsByFile.set(file, existing);
		return;
	}
	const filename = path.basename(file);
	const extension = path.extname(filename).slice(1).toLowerCase();
	const contentType = contentTypes[extension];
	if (contentType == null) {
		throw new ConversionError(`Asset "${file}" has an unknown file type.`);
	}
	let width: number | null = null;
	let height: number | null = null;
	if (contentType.startsWith("image/")) {
		try {
			const dimensions = imageSize(bytes);
			width = dimensions.width;
			height = dimensions.height;
		} catch {
			adjust(path.relative(publicDirectory, file), "Could not read the image dimensions.");
		}
	}
	const stem = path
		.basename(filename, path.extname(filename))
		.toLowerCase()
		.replaceAll(/[^\da-z]+/g, "-")
		.replaceAll(/^-|-$/g, "");
	const asset: MediaAsset = {
		id: createStableId(`media/${sha256}`),
		slug: `${stem || "file"}-${sha256.slice(0, 8)}`,
		file,
		filename,
		sha256,
		size: bytes.byteLength,
		contentType,
		key: getUploadKey(
			{ sha256, size: bytes.byteLength, contentType, filename },
			{ contentTypes: mediaContentTypes, maxSize: maxMediaSize },
		),
		width,
		height,
		usedBy: new Set(),
	};
	assetsByHash.set(sha256, asset);
	assetsByFile.set(file, asset);
}

/**
 * Loads every asset an entry mentions before it is converted, so conversion can be synchronous: the rich text converter
 * merges adjacent text with equal marks, which must see the final props.
 */
async function loadAssets(text: string): Promise<void> {
	for (const match of text.matchAll(/\/assets\/[^\s"'()<>\]\\]+/g)) {
		try {
			await loadAsset(resolveAssetFile(match[0], null));
		} catch {
			/** Reported when the asset is used. */
		}
	}
}

function getMediaAsset(url: string, entry: string): MediaAsset {
	const asset = assetsByFile.get(resolveAssetFile(url, entry));
	if (asset == null) {
		throw new ConversionError(`Asset "${url}" was not loaded.`);
	}
	asset.usedBy.add(entry);
	return asset;
}

function createMediaEntry(asset: MediaAsset): StoredEntry {
	return {
		collection: "media",
		id: asset.id,
		locale,
		slug: asset.slug,
		translationGroup: asset.id,
		data: {
			title: asset.filename,
			file: {
				key: asset.key,
				filename: asset.filename,
				contentType: asset.contentType,
				size: asset.size,
				width: asset.width,
				height: asset.height,
			},
			license: null,
			credit: null,
			source: null,
			focalPoint: { x: 0.5, y: 0.5 },
		},
	};
}

// -------------------------------------------------------------------------------------------------------------
// Values
// -------------------------------------------------------------------------------------------------------------

interface Context {
	/** `collection/slug`, for messages. */
	entry: string;
	/** The entry's directory, where Keystatic keeps nested rich text fields as files. */
	directory: string | null;
	/** The entry's markdown body, which holds the `content` field. */
	body: string | null;
	/** Field path from the entry root. */
	path: Array<string | number>;
}

function toKeystaticKey(key: string): string {
	if (key === "language") {
		return "locale";
	}
	return key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** URLs without a scheme, e.g. `www.dariah.eu`, were links relative to the page; `https://` was meant. */
function getUrl(url: string, context: Context): string {
	if (url.startsWith("www.")) {
		adjust(context.entry, `URL "${url}" → "https://${url}".`);
		return `https://${url}`;
	}
	return url;
}

function isEmpty(value: unknown): boolean {
	return value == null || value === "";
}

function getRelationship(collection: string, slug: unknown, context: Context): string | null {
	if (isEmpty(slug)) {
		return null;
	}
	if (typeof slug !== "string") {
		throw new ConversionError(`Expected a slug at ${context.path.join(".")}.`);
	}
	if (knownSlugs.get(collection)?.has(slug) !== true) {
		throw new ConversionError(`Missing ${collection} entry "${slug}" at ${context.path.join(".")}.`);
	}
	return getEntryId(collection, slug);
}

/** Lists of relationships drop entries which do not exist, as the site did when rendering them. */
function getRelationships(collection: string, slugs: unknown, context: Context): Array<string> {
	const ids: Array<string> = [];
	for (const slug of Array.isArray(slugs) ? slugs : []) {
		if (typeof slug === "string" && knownSlugs.get(collection)?.has(slug) !== true) {
			adjust(context.entry, `Dropped missing ${collection} entry "${slug}" from ${context.path.join(".")}.`);
			continue;
		}
		const id = getRelationship(collection, slug, context);
		if (id != null) {
			ids.push(id);
		}
	}
	return ids;
}

/** Links to entries are fixed when the target is unambiguous: a known typo, or the slug exists in one other collection. */
function getLinkTarget(collection: string, slug: string, context: Context): { collection: string; id: string } {
	const fixed = slugFixes[slug] ?? slug;
	if (knownSlugs.get(collection)?.has(fixed) === true) {
		if (fixed !== slug) {
			adjust(context.entry, `Link to "${slug}" → "${fixed}".`);
		}
		return { collection, id: getEntryId(collection, fixed) };
	}
	const candidates = linkTargets.filter((name) => knownSlugs.get(name)?.has(fixed) === true);
	if (candidates.length === 1) {
		adjust(context.entry, `Link to ${collection} "${slug}" → ${candidates[0]!} "${fixed}".`);
		return { collection: candidates[0]!, id: getEntryId(candidates[0]!, fixed) };
	}
	throw new ConversionError(`Missing ${collection} entry "${slug}" at ${context.path.join(".")}.`);
}

function getHash(value: unknown): string | null {
	if (isEmpty(value)) {
		return null;
	}
	/** Keystatic stored fragments without `#`; the site added it. */
	const hash = String(value);
	return hash.startsWith("#") ? hash : `#${hash}`;
}

function getImage(url: unknown, alt: unknown, context: Context) {
	if (isEmpty(url)) {
		return null;
	}
	const asset = getMediaAsset(String(url), context.entry);
	return { media: asset.id, alt: isEmpty(alt) ? null : String(alt), decorative: false };
}

function getLink(value: unknown, context: Context): unknown {
	if (isEmpty(value)) {
		return null;
	}
	const { discriminant, value: target } = value as { discriminant: string; value: unknown };
	switch (discriminant) {
		case "external": {
			if (isEmpty(target)) {
				return null;
			}
			const url = String(target);
			/** A bare word resolved relative to the page, which never worked; a fragment was meant. */
			if (/^[\w-]+$/.test(url)) {
				adjust(context.entry, `External link "${url}" → "#${url}".`);
				return { kind: "hash", hash: `#${url}` };
			}
			return { kind: "external", url: getUrl(url, context) };
		}
		case "email": {
			return { kind: "email", email: String(target) };
		}
		case "hash": {
			return { kind: "hash", hash: getHash(target) };
		}
		case "download": {
			const asset = getMediaAsset(String(target), context.entry);
			return { kind: "download", media: asset.id };
		}
		case "search": {
			const { search, hash } = target as { search?: string; hash?: string };
			return { kind: "search", search: isEmpty(search) ? null : search, hash: getHash(hash) };
		}
		default: {
			const { id, hash } = target as { id: string; hash?: string };
			return { kind: "entry", ...getLinkTarget(discriminant, id, context), hash: getHash(hash) };
		}
	}
}

function convertValue(field: AnyField, value: unknown, context: Context): unknown {
	const definition = field as AnyField & Record<string, unknown>;
	switch (field.kind) {
		case "text": {
			if (isEmpty(value)) {
				return field.getDefaultValue();
			}
			const text = String(value);
			if (definition.multiline !== true && text.trim().includes("\n")) {
				adjust(context.entry, `Joined the lines of ${context.path.join(".")}.`);
				return text.trim().replaceAll(/\s*\n\s*/g, " ");
			}
			return text;
		}
		case "url": {
			return isEmpty(value) ? field.getDefaultValue() : getUrl(String(value), context);
		}
		case "email":
		case "date":
		case "datetime":
		case "handle": {
			return isEmpty(value) ? null : String(value);
		}
		case "number":
		case "integer": {
			return typeof value === "number" ? value : field.getDefaultValue();
		}
		case "checkbox": {
			return typeof value === "boolean" ? value : field.getDefaultValue();
		}
		case "select": {
			return isEmpty(value) ? field.getDefaultValue() : value;
		}
		case "relationship": {
			const collection = definition.collection as string;
			if (definition.multiple === true) {
				return getRelationships(collection, value, context);
			}
			return getRelationship(collection, value, context);
		}
		case "image": {
			return getImage(value, null, context);
		}
		case "file": {
			if (isEmpty(value)) {
				return null;
			}
			return { media: getMediaAsset(String(value), context.entry).id };
		}
		case "link": {
			return getLink(value, context);
		}
		case "empty": {
			return null;
		}
		case "object": {
			const fields = definition.fields as Record<string, AnyField>;
			/** Items of quizzes may be written as strings, e.g. `items={["Charter"]}`, which the components accept. */
			if (typeof value === "string" && Object.keys(fields).join() === "label") {
				return { label: value };
			}
			const source = (value ?? {}) as Record<string, unknown>;
			const result: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(fields)) {
				const sourceKey = key === "image" && !(toKeystaticKey(key) in source) ? "src" : toKeystaticKey(key);
				result[key] = convertValue(child, source[sourceKey], {
					...context,
					path: [...context.path, key],
				});
			}
			return result;
		}
		case "array": {
			const item = definition.item as AnyField;
			/** Lists of words may be written as one string, e.g. `distractors="merge, rebase"`, which the components accept. */
			const list =
				typeof value === "string"
					? value
							.split(",")
							.map((word) => word.trim())
							.filter(Boolean)
					: value;
			const items = Array.isArray(list) ? list : [];
			const result: Array<unknown> = [];
			for (const [index, element] of items.entries()) {
				result.push(convertValue(item, element, { ...context, path: [...context.path, index] }));
			}
			return result;
		}
		case "union": {
			const options = definition.options as Record<string, AnyField>;
			const { discriminant, value: inner } = value as { discriminant: string; value: unknown };
			const option = options[discriminant];
			if (option == null) {
				throw new ConversionError(`Unknown option "${discriminant}" at ${context.path.join(".")}.`);
			}
			return { kind: discriminant, value: convertValue(option, inner, context) };
		}
		case "rich-text": {
			return convertRichText(field, value, context);
		}
		default: {
			throw new ConversionError(`Unsupported field kind "${field.kind}" at ${context.path.join(".")}.`);
		}
	}
}

// -------------------------------------------------------------------------------------------------------------
// Rich text
// -------------------------------------------------------------------------------------------------------------

/** Keystatic keeps the `content` field in the body, inline rich text in the data, and others in their own files. */
function getMarkdown(value: unknown, context: Context): string {
	if (typeof value === "string") {
		return value;
	}
	if (context.path.length === 1 && context.path[0] === "content" && context.body != null) {
		return context.body;
	}
	if (context.directory == null) {
		return "";
	}
	const file = path.join(
		context.directory,
		`${context.path.map((segment) => toKeystaticKey(String(segment))).join("/")}.mdx`,
	);
	return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

function convertRichText(field: AnyField, value: unknown, context: Context): RichTextRoot {
	const markdown = getMarkdown(value, context);
	const components = new Map<string, AnyComponent>(
		(field as unknown as { getComponents: () => Array<AnyComponent> })
			.getComponents()
			.map((component) => [component.name, component]),
	);
	const levels = new Set<number>(
		(field as unknown as { content: { blocks?: { heading?: { levels?: Array<number> } } } }).content.blocks?.heading
			?.levels ?? [1, 2, 3, 4, 5, 6],
	);

	function convertProps(component: AnyComponent, helpers: ConversionHelpers, element: MdxJsxElement) {
		const props: Record<string, unknown> = {};
		const attributes = { ...helpers.attributes };
		for (const [from, to] of Object.entries(attributeRenames[context.entry]?.[component.name] ?? {})) {
			if (from in attributes) {
				adjust(context.entry, `<${component.name}> attribute "${from}" → "${to}".`);
				attributes[to] = attributes[from];
				delete attributes[from];
			}
		}
		/** Video ids pasted as URLs. */
		if (typeof attributes.id === "string" && attributes.provider === "youtube" && /^https?:/.test(attributes.id)) {
			const url = new URL(attributes.id);
			const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
			if (id != null && id !== "") {
				adjust(context.entry, `<${component.name}> video id "${attributes.id}" → "${id}".`);
				attributes.id = id;
			}
		}
		for (const [key, prop] of Object.entries(component.props)) {
			const propContext = { ...context, path: [...context.path, element.name ?? "", key] };
			if (prop.kind === "image") {
				const sourceKey = key === "image" ? "src" : key;
				const altKey = key === "image" ? "alt" : `${key}Alt`;
				const source = attributes[sourceKey];
				const alt = attributes[altKey];
				delete attributes[sourceKey];
				delete attributes[altKey];
				props[key] = getImage(source, alt, propContext);
				continue;
			}
			const attribute = attributes[key];
			delete attributes[key];
			props[key] = convertValue(prop, attribute, propContext);
		}
		const unknown = Object.keys(attributes);
		if (unknown.length > 0) {
			helpers.fail(`Unknown props ${unknown.map((key) => `"${key}"`).join(", ")} on <${component.name}>.`);
		}
		return props;
	}

	function jsx(element: MdxJsxElement, helpers: ConversionHelpers): BlockNode | InlineNode | Array<InlineNode> {
		const component = components.get(element.name ?? "");
		if (component == null) {
			return helpers.fail(`Unknown component <${String(element.name)}>.`);
		}
		const props = convertProps(component, helpers, element);
		switch (component.kind) {
			case "mark": {
				return helpers.inline(undefined, [{ type: "component", name: component.name, props }]);
			}
			case "wrapper": {
				return { type: "component", name: component.name, props, children: helpers.blocks() };
			}
			case "repeating": {
				return { type: "component", name: component.name, props, children: helpers.components() };
			}
			case "block":
			case "inline": {
				if (element.children.length > 0) {
					helpers.fail(`<${component.name}> does not take children.`);
				}
				return { type: "component", name: component.name, props, children: [] } satisfies ComponentNode;
			}
		}
	}

	let tree: RichTextRoot;
	try {
		tree = fromMdast(processor.parse(markdown) as unknown as MdastNode, {
			jsx,
			image(image) {
				return {
					type: "component",
					name: "Image",
					props: { image: getImage(image.url, image.alt, context), title: image.title },
					children: [],
				};
			},
			footnote() {
				return { type: "component", name: "Footnote", props: {} };
			},
		});
	} catch (error) {
		throw new ConversionError(`${context.path.join(".")}: ${(error as Error).message}`);
	}
	/** Links without a target rendered as plain text; they become plain text. */
	function removeEmptyLinks(node: {
		children?: Array<unknown>;
		marks?: Array<{ type: string; name?: string; props?: Record<string, unknown> }>;
	}): void {
		if (node.marks != null) {
			const marks = node.marks.filter(
				(mark) => !(mark.type === "component" && mark.name === "Link" && mark.props?.link == null),
			);
			if (marks.length !== node.marks.length) {
				adjust(context.entry, "Removed a link without a target.");
				node.marks = marks;
				if (marks.length === 0) {
					delete node.marks;
				}
			}
		}
		node.children?.forEach((child) => {
			removeEmptyLinks(child as typeof node);
		});
	}
	removeEmptyLinks(tree);

	/** A few entries use level 1, which is the page title's. */
	function clampHeadings(nodes: Array<BlockNode>): void {
		for (const node of nodes) {
			if (node.type === "heading" && !levels.has(node.level)) {
				const allowed = [...levels].toSorted((a, b) => a - b);
				const level = (node.level < allowed[0]! ? allowed[0] : allowed.at(-1)) as typeof node.level;
				adjustments.push({ entry: context.entry, message: `Heading level ${String(node.level)} → ${String(level)}.` });
				node.level = level;
			}
			if ("children" in node && node.type !== "heading" && node.type !== "paragraph" && node.type !== "table") {
				clampHeadings(node.children as Array<BlockNode>);
			}
			if (node.type === "list") {
				node.children.forEach((item) => {
					clampHeadings(item.children);
				});
			}
		}
	}
	clampHeadings(tree.children);

	return tree;
}

// -------------------------------------------------------------------------------------------------------------
// Sources
// -------------------------------------------------------------------------------------------------------------

interface Source {
	collection: string;
	slug: string;
	directory: string | null;
	data: Record<string, unknown>;
	body: string | null;
}

function parseMdx(contents: string): { data: Record<string, unknown>; body: string } {
	const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?/.exec(contents);
	if (match == null) {
		return { data: {}, body: contents };
	}
	return {
		data: (parseYaml(match.groups!.frontmatter!) ?? {}) as Record<string, unknown>,
		body: contents.slice(match[0].length),
	};
}

/** Everything an entry consists of, where asset paths may appear: data, body, and nested rich text files. */
async function getSourceText(source: Source): Promise<string> {
	const parts = [JSON.stringify(source.data), source.body ?? ""];
	if (source.directory != null) {
		for (const item of await fs.readdir(source.directory, { recursive: true, withFileTypes: true })) {
			if (item.isFile() && item.name.endsWith(".mdx")) {
				parts.push(await fs.readFile(path.join(item.parentPath, item.name), "utf-8"));
			}
		}
	}
	return parts.join("\n");
}

async function readCollection(name: string, directory: string): Promise<Array<Source>> {
	const base = path.join(contentDirectory, directory);
	const sources: Array<Source> = [];
	for (const item of (await fs.readdir(base, { withFileTypes: true })).toSorted((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (item.isDirectory()) {
			const file = path.join(base, item.name, "index.mdx");
			if (!existsSync(file)) {
				continue;
			}
			const { data, body } = parseMdx(await fs.readFile(file, "utf-8"));
			sources.push({ collection: name, slug: item.name, directory: path.join(base, item.name), data, body });
		} else if (item.name.endsWith(".json")) {
			const data = JSON.parse(await fs.readFile(path.join(base, item.name), "utf-8")) as Record<string, unknown>;
			sources.push({ collection: name, slug: item.name.slice(0, -5), directory: null, data, body: null });
		}
	}
	return sources;
}

async function readSingleton(name: string, directory: string): Promise<Source> {
	const base = path.join(contentDirectory, directory);
	if (existsSync(path.join(base, "index.json"))) {
		const data = JSON.parse(await fs.readFile(path.join(base, "index.json"), "utf-8")) as Record<string, unknown>;
		return { collection: name, slug: "", directory: base, data, body: null };
	}
	const { data, body } = parseMdx(await fs.readFile(path.join(base, "index.mdx"), "utf-8"));
	return { collection: name, slug: "", directory: base, data, body };
}

// -------------------------------------------------------------------------------------------------------------
// Run
// -------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
	const collections = schema.collections.filter((collection) => collection.isMedia !== true);
	const sources = new Map<string, Array<Source>>();
	for (const collection of collections) {
		const items = await readCollection(collection.name, collection.path);
		sources.set(collection.name, items);
		knownSlugs.set(collection.name, new Set(items.map((item) => item.slug)));
	}

	const published: Array<StoredEntry> = [];
	const drafts: Array<StoredEntry> = [];

	async function convertSource(source: Source, entry: Omit<StoredEntry, "data">): Promise<void> {
		const label = `${source.collection}/${source.slug || locale}`;
		const collection = schema.get(source.collection)!;
		try {
			await loadAssets(await getSourceText(source));
			const data = convertValue(collection.data, source.data, {
				entry: label,
				directory: source.directory,
				body: source.body,
				path: [],
			});
			const result = validateData(collection, data);
			if (!result.success) {
				for (const issue of result.issues) {
					problems.push({ entry: label, message: `${issue.path.join(".")}: ${issue.message}` });
				}
				return;
			}
			(source.data.draft === true ? drafts : published).push({ ...entry, data });
		} catch (error) {
			if (!(error instanceof ConversionError)) {
				throw error;
			}
			problems.push({ entry: label, message: error.message });
		}
	}

	for (const [name, items] of sources) {
		for (const source of items) {
			const id = getEntryId(name, source.slug);
			await convertSource(source, { collection: name, id, locale, slug: source.slug, translationGroup: id });
		}
	}
	for (const singleton of schema.singletons) {
		const source = await readSingleton(singleton.name, singleton.path);
		await convertSource(source, getSingletonIdentity(singleton.name, locale));
	}

	const media = [...assetsByHash.values()].map((asset) => createMediaEntry(asset));
	for (const entry of media) {
		const result = validateData(schema.get("media")!, entry.data);
		if (!result.success) {
			problems.push({ entry: `media/${entry.slug}`, message: result.issues.map((issue) => issue.message).join("; ") });
		}
	}

	await fs.rm(outputDirectory, { recursive: true, force: true });
	async function write(directory: string, entries: Array<StoredEntry>): Promise<void> {
		for (const entry of entries) {
			const file = path.join(directory, format.getPath(entry));
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, format.serialize(entry));
		}
	}
	await write(path.join(outputDirectory, "content"), [...published, ...media]);
	await write(path.join(outputDirectory, "drafts"), drafts);

	if (args["copy-media"]) {
		for (const asset of assetsByHash.values()) {
			const target = path.join(outputDirectory, "media-files", asset.key);
			await fs.mkdir(path.dirname(target), { recursive: true });
			/** Hard links save copying the files, where the filesystem allows it. */
			await fs.link(asset.file, target).catch(() => fs.copyFile(asset.file, target));
			await fs.writeFile(`${target}.meta.json`, JSON.stringify({ contentType: asset.contentType }));
		}
	}

	const unused = await findUnusedAssets();
	/** Public paths of assets and the media keys they became, for comparing rendered pages. */
	const assets = Object.fromEntries(
		[...assetsByFile.entries()]
			.map(([file, asset]) => [`/${path.relative(publicDirectory, file)}`, asset.key] as const)
			.toSorted(([a], [z]) => a.localeCompare(z)),
	);
	await fs.writeFile(path.join(outputDirectory, "assets.json"), `${JSON.stringify(assets, null, "\t")}\n`);

	const report = {
		entries: published.length,
		drafts: drafts.map((entry) => `${entry.collection}/${entry.slug}`),
		media: media.length,
		unusedAssets: unused,
		adjustments,
		problems,
	};
	await fs.writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, "\t")}\n`);

	log.info(
		`Converted ${String(published.length)} entries, ${String(drafts.length)} drafts, ${String(media.length)} media files.`,
	);
	log.info(`${String(adjustments.length)} adjustments, ${String(unused.length)} unused assets; see report.json.`);
	if (problems.length > 0) {
		for (const problem of problems) {
			log.error(`${problem.entry}: ${problem.message}`);
		}
		throw new Error(`${String(problems.length)} problems.`);
	}
}

async function findUnusedAssets(): Promise<Array<string>> {
	const unused: Array<string> = [];
	const directory = path.join(publicDirectory, "assets", "content");
	for (const item of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
		if (item.isFile()) {
			const file = path.join(item.parentPath, item.name);
			if (!assetsByFile.has(file)) {
				unused.push(path.relative(publicDirectory, file));
			}
		}
	}
	return unused.toSorted();
}

main()
	.then(() => {
		log.success("Converted the content.");
	})
	.catch((error: unknown) => {
		log.error("Failed to convert the content.\n", error);
		process.exitCode = 1;
	});
