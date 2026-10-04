/**
 * Compares the rendered content of every page between the mdx pipeline and the CMS: both sites run locally, and the
 * content regions (`.prose`) and tables of contents of each page are normalised and compared.
 *
 * Usage: `tsx ./scripts/cms/render-diff.ts --old http://localhost:3457 --new http://localhost:3456 [--only <path>]`
 *
 * Image sources differ by design (public assets vs. media library), so they are compared through `assets.json`, the
 * mapping written by `scripts/cms/migrate.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { log } from "@acdh-oeaw/lib";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { selectAll } from "hast-util-select";
import pLimit from "p-limit";

const { values: args } = parseArgs({
	options: {
		old: { type: "string", default: "http://localhost:3457" },
		new: { type: "string", default: "http://localhost:3456" },
		output: { type: "string", default: ".cms-migration" },
		only: { type: "string", multiple: true },
		/** Compares only pages whose path starts with this. */
		prefix: { type: "string" },
		limit: { type: "string" },
		concurrency: { type: "string", default: "2" },
	},
});

const outputDirectory = path.resolve(args.output);
const assets = JSON.parse(await fs.readFile(path.join(outputDirectory, "assets.json"), "utf-8")) as Record<
	string,
	string
>;
const keysByFile = new Map(Object.entries(assets));

const report = JSON.parse(await fs.readFile(path.join(outputDirectory, "report.json"), "utf-8")) as {
	drafts: Array<string>;
};
/** Drafts are not published any more, so links to them are text on the new site. */
const draftPaths = new Set(
	report.drafts.map((draft) => {
		const [collection, slug] = draft.split("/");
		return `/${collection!.replace("resources-", "resources/")}/${slug!}`;
	}),
);

// -------------------------------------------------------------------------------------------------------------
// Pages
// -------------------------------------------------------------------------------------------------------------

const collections: Record<string, string> = {
	"resources/hosted": "/resources/hosted/",
	"resources/external": "/resources/external/",
	"resources/pathfinders": "/resources/pathfinders/",
	"resources/events": "/resources/events/",
	curricula: "/curricula/",
	documentation: "/documentation/",
	people: "/people/",
	tags: "/topics/",
	sources: "/sources/",
};

async function getPages(): Promise<Array<string>> {
	const pages = ["/", "/imprint"];
	for (const [directory, prefix] of Object.entries(collections)) {
		const slugs = await fs.readdir(path.join(outputDirectory, "content", "en", directory));
		for (const slug of slugs.toSorted()) {
			pages.push(`${prefix}${slug}`);
		}
	}
	return pages;
}

// -------------------------------------------------------------------------------------------------------------
// Explained differences
// -------------------------------------------------------------------------------------------------------------

/** Differences which are intended, with the reason. Lines of the old page are replaced before comparing. */
const explained: Record<string, Array<{ old: string | RegExp; new: string; reason: string; side?: "new" }>> = {
	"/resources/hosted/introduction-to-the-european-collaborative-cloud-for-cultural-heritage": [
		{
			old: 'href="supplementary-reading-for-unit-4"',
			new: 'href="#supplementary-reading-for-unit-4"',
			reason:
				"A link to a bare word resolved relative to the page; the migration made it the fragment it was meant to be.",
		},
	],
	"/documentation/types-of-resources": [
		{
			old: 'href="/resources/external/citizen-science-in-the-digital-arts-and-humanities"',
			new: 'href="/resources/hosted/citizen-science-in-the-digital-arts-and-humanities"',
			reason: "The link named the wrong collection; the migration found the resource in the right one.",
		},
	],
	"/imprint": [
		{
			old: / id="[^"]*"/g,
			new: "",
			side: "new",
			reason: "Headings of the legal notice get identifiers, like those of every other page.",
		},
	],
	"/resources/hosted/data-protection-in-research-practice-a-tutorial": [
		{
			old: ' src="media:originals/f4d466667c43448621347c2dc271be4fdc3546ea13cbcf5903a8708e7a83fdad.jpg"',
			new: "",
			side: "new",
			reason:
				"The video card's image lost its attribute name in the mdx, so it was not shown; the migration restored it.",
		},
	],
	"/resources/hosted/citizen-science-in-the-digital-arts-and-humanities": [
		{
			old: "case-study-perceptual-dialectology-of-irish-accents-projectwhat-is-perceptual-dialectology",
			new: "case-study-perceptual-dialectology-of-irish-accents-project-what-is-perceptual-dialectology",
			reason: "A newline written as `&#xA;` in the heading is a space now, which changes the generated id.",
		},
	],
};

/** Pages which are not compared, with the reason. Check them by hand. */
const skipPages: Record<string, string> = {
	"/resources/hosted/standards-for-representing-lexicographic-data-an-overview":
		"A gfm footnote referenced twice is repeated in rich text, which numbers the footnotes after it one higher.",
};

/** Pages whose table of contents is not compared, with the reason. */
const skipTableOfContents: Record<string, string> = Object.fromEntries(
	[
		"/resources/hosted/introduction-to-europeana-apis",
		"/resources/hosted/lex2-mastering-elexis-corpus-tools-for-lexicographic-purposes",
		"/resources/pathfinders/elexis-pathfinder-to-computional-lexicography-for-developers-and-computational-linguists",
	].map((page) => [page, "Headings of level 1 became level 2, which changes the outline."]),
);

/** Headings of level 1 in content became level 2, see `report.json`. */
function normalizeHeadingLevel(tagName: string): string {
	return tagName === "h1" ? "h2" : tagName;
}

// -------------------------------------------------------------------------------------------------------------
// Normalisation
// -------------------------------------------------------------------------------------------------------------

/** Image sources, as the media key they point to. */
function normalizeSource(value: string): string {
	let source = value;
	if (source.startsWith("/_next/image?")) {
		source = new URL(source, "http://localhost").searchParams.get("url") ?? source;
	}
	source = decodeURIComponent(source);
	const key = keysByFile.get(source);
	if (key != null) {
		return `media:${key}`;
	}
	const match = /\/media\/store\/file\/(?<key>.+)$/.exec(source);
	if (match != null) {
		return `media:${match.groups!.key!}`;
	}
	return source;
}

/** Attributes which differ between renders without meaning anything: generated ids and responsive image candidates. */
const ignoredAttributes = new Set(["srcSet", "sizes", "dataNimg", "decoding", "loading", "fetchPriority"]);

/**
 * Footnote anchors: gfm footnotes (`[^label]`) used their label, `<Footnote>` elements a counter. All footnotes are
 * numbered now; the reference numbers shown are compared as text.
 */
function normalizeFootnoteId(value: string): string {
	return value.replace(/^(?<prefix>#?user-content-fn(?:ref)?-).+$/, "$<prefix>(footnote)");
}

function isGeneratedId(value: unknown): boolean {
	return typeof value === "string" && /react-aria|^_r_|«r|:r[\da-z]+:/.test(value);
}

/** Formatting which nests in itself renders the same as once, e.g. `<strong><strong>`. */
const formattingTags = new Set(["strong", "em", "del", "s", "code", "sub", "sup", "u"]);

function normalize(node: Root | Element): void {
	const children: Array<ElementContent | RootContent> = [];
	function flatten(nodes: Array<ElementContent | RootContent>): Array<ElementContent | RootContent> {
		return nodes.flatMap((child) =>
			/** Links without a target, which the migration removed (see `report.json`). */
			child.type === "element" &&
			child.tagName === "span" &&
			child.properties.role === "link" &&
			Array.isArray(child.properties.className) &&
			child.properties.className.join(" ") === "react-aria-Link"
				? flatten(child.children)
				: child.type === "element" &&
					  child.tagName === "a" &&
					  typeof child.properties.href === "string" &&
					  /** One link to a draft also has a typo, a trailing `)`. */
					  draftPaths.has(child.properties.href.split("#")[0]!.replace(/\)$/, ""))
					? flatten(child.children)
					: node.type === "element" &&
						  child.type === "element" &&
						  formattingTags.has(child.tagName) &&
						  child.tagName === node.tagName &&
						  Object.keys(child.properties).length === 0
						? flatten(child.children)
						: [child],
		);
	}
	/**
	 * Formatting around a whole link is inside the link in rich text: markdown `*[text](url)*` was `<em><a>`, and is
	 * `<a><em>` now, which looks the same.
	 */
	function moveIntoLink(child: ElementContent | RootContent): ElementContent | RootContent {
		if (child.type !== "element" || !formattingTags.has(child.tagName)) {
			return child;
		}
		const inner = child.children.filter(
			(grandchild) => !(grandchild.type === "text" && grandchild.value.trim() === ""),
		);
		const link = inner[0];
		if (inner.length !== 1 || link?.type !== "element" || link.tagName !== "a") {
			return child;
		}
		return { ...link, children: [{ ...child, children: link.children.map(moveIntoLink) as Array<ElementContent> }] };
	}
	const flattened = flatten(node.children).map(moveIntoLink);
	for (const child of flattened) {
		if (child.type === "comment" || child.type === "doctype") {
			continue;
		}
		if (child.type === "text") {
			const value = child.value.replaceAll(/\s+/g, " ");
			if (value.trim() === "") {
				continue;
			}
			const previous = children.at(-1);
			if (previous?.type === "text") {
				previous.value += value;
				continue;
			}
			children.push({ type: "text", value });
			continue;
		}
		if (child.type === "element") {
			const properties: Record<string, Element["properties"][string]> = {};
			for (const [key, value] of Object.entries(child.properties).toSorted(([a], [z]) => a.localeCompare(z))) {
				if (ignoredAttributes.has(key) || isGeneratedId(value)) {
					continue;
				}
				if (key === "ariaLabelledBy" || key === "ariaDescribedBy" || key === "ariaControls" || key === "htmlFor") {
					properties[key] = Array.isArray(value) && value.some((item) => isGeneratedId(item)) ? "(generated)" : value;
					continue;
				}
				properties[key] =
					(key === "src" || key === "href") && typeof value === "string"
						? normalizeFootnoteId(normalizeSource(value))
						: key === "id" && typeof value === "string"
							? normalizeFootnoteId(value)
							: value;
			}
			child.properties = properties;
			child.tagName = normalizeHeadingLevel(child.tagName);
			normalize(child);
		}
		children.push(child);
	}
	node.children = children;
}

/** Inline formatting and links: compared as text runs with their formatting, whatever the nesting order. */
const inlineTags = new Set([...formattingTags, "a"]);

function describe(node: Element): string {
	const attributes = Object.entries(node.properties)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(" ");
	return `${node.tagName}${attributes ? ` ${attributes}` : ""}`;
}

/** One line per block element and per run of text with the same formatting, so differences can be located. */
function print(node: ElementContent, depth = 0, formatting: Array<string> = []): Array<string> {
	const indent = "  ".repeat(depth);
	if (node.type === "text") {
		const context = [...new Set(formatting)].toSorted();
		return [`${indent}"${node.value.trim()}"${context.length > 0 ? ` [${context.join(" | ")}]` : ""}`];
	}
	if (node.type !== "element") {
		return [];
	}
	if (inlineTags.has(node.tagName)) {
		return node.children.flatMap((child) => print(child, depth, [...formatting, describe(node)]));
	}
	return [`${indent}<${describe(node)}>`, ...mergeRuns(node.children.flatMap((child) => print(child, depth + 1)))];
}

/** Adjacent text with the same formatting is one run, however it was split up by elements. */
function mergeRuns(lines: Array<string>): Array<string> {
	const result: Array<string> = [];
	for (const line of lines) {
		const match = /^(?<indent>\s*)"(?<text>.*)"(?<context>(?: \[.*\])?)$/.exec(line);
		const previous = result.at(-1);
		const previousMatch =
			previous != null ? /^(?<indent>\s*)"(?<text>.*)"(?<context>(?: \[.*\])?)$/.exec(previous) : null;
		if (
			match != null &&
			previousMatch != null &&
			match.groups!.indent === previousMatch.groups!.indent &&
			match.groups!.context === previousMatch.groups!.context
		) {
			result[result.length - 1] =
				`${match.groups!.indent!}"${previousMatch.groups!.text!} ${match.groups!.text!}"${match.groups!.context!}`.replaceAll(
					/ {2,}/g,
					" ",
				);
			continue;
		}
		result.push(line);
	}
	return result;
}

function extract(html: string, page: string): Array<string> {
	const tree = fromHtml(html);
	normalize(tree);
	const regions = [
		...selectAll(".prose", tree),
		...(page in skipTableOfContents ? [] : selectAll('[aria-labelledby="table-of-contents"]', tree)),
		...selectAll("main h1", tree),
	];
	return regions.flatMap((region) => print(region));
}

// -------------------------------------------------------------------------------------------------------------
// Run
// -------------------------------------------------------------------------------------------------------------

interface Difference {
	page: string;
	status?: string;
	line?: number;
	old?: Array<string>;
	new?: Array<string>;
}

async function fetchPage(base: string, page: string): Promise<{ status: number; html: string }> {
	const response = await fetch(new URL(page, base), { redirect: "follow" });
	return { status: response.status, html: await response.text() };
}

async function compare(page: string): Promise<Difference | null> {
	const [before, after] = await Promise.all([fetchPage(args.old, page), fetchPage(args.new, page)]);
	if (before.status !== after.status) {
		return { page, status: `${String(before.status)} → ${String(after.status)}` };
	}
	const changes = explained[page] ?? [];
	const a = extract(before.html, page).map((line) =>
		changes
			.filter((change) => change.side !== "new")
			.reduce((result, change) => result.replaceAll(change.old, change.new), line),
	);
	const b = extract(after.html, page).map((line) =>
		changes
			.filter((change) => change.side === "new")
			.reduce((result, change) => result.replaceAll(change.old, change.new), line),
	);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index++) {
		if (a[index] !== b[index]) {
			return {
				page,
				line: index,
				old: a.slice(Math.max(0, index - 3), index + 4),
				new: b.slice(Math.max(0, index - 3), index + 4),
			};
		}
	}
	return null;
}

async function main(): Promise<void> {
	let pages = args.only ?? (await getPages());
	pages = pages.filter((page) => !(page in skipPages));
	if (args.prefix != null) {
		pages = pages.filter((page) => page.startsWith(args.prefix!));
	}
	if (args.limit != null) {
		pages = pages.slice(0, Number(args.limit));
	}
	/** Differences are also appended as they are found, so a long run can be inspected while it runs. */
	const progressFile = path.join(outputDirectory, "render-diff.jsonl");
	await fs.writeFile(progressFile, "");
	const limit = pLimit(Number(args.concurrency));
	const differences: Array<Difference> = [];
	let done = 0;
	await Promise.all(
		pages.map((page) =>
			limit(async () => {
				try {
					const difference = await compare(page);
					if (difference != null) {
						differences.push(difference);
						await fs.appendFile(progressFile, `${JSON.stringify(difference)}\n`);
					}
				} catch (error) {
					differences.push({ page, status: `failed: ${(error as Error).message}` });
				}
				done++;
				if (done % 50 === 0) {
					log.info(`${String(done)}/${String(pages.length)} pages, ${String(differences.length)} differ.`);
				}
			}),
		),
	);
	differences.sort((a, z) => a.page.localeCompare(z.page));
	await fs.writeFile(path.join(outputDirectory, "render-diff.json"), `${JSON.stringify(differences, null, "\t")}\n`);
	log.info(`${String(pages.length - differences.length)} of ${String(pages.length)} pages render the same.`);
	if (differences.length > 0) {
		throw new Error(`${String(differences.length)} pages differ; see render-diff.json.`);
	}
}

main()
	.then(() => {
		log.success("Compared the rendered content.");
	})
	.catch((error: unknown) => {
		log.error("Failed to compare the rendered content.\n", error);
		process.exitCode = 1;
	});
