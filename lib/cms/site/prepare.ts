import { typographyConfig } from "@acdh-oeaw/mdx-lib";
import type {
	BlockNode,
	ComponentMark,
	ComponentNode,
	InlineNode,
	Mark,
	RichTextRoot,
	TextNode,
} from "@stefanprobst/cms/rich-text";
import GithubSlugger from "github-slugger";
import withTypographicQuotes from "remark-smartypants";

import type { IntlLanguage } from "#/lib/i18n/locales.ts";

/**
 * Prepares rich text for rendering, doing what the remark and rehype plugins of the mdx pipeline did: typographic
 * quotes, footnotes, blanks in quizzes, heading identifiers, content sections, the table of contents, and component
 * props in the shape the content components expect.
 *
 * @see lib/content/mdx/remark-plugins.ts
 * @see lib/content/mdx/rehype-plugins.ts
 */

export interface ContentSection {
	id: string;
	label: string | null;
	headingIds: Array<string>;
}

export interface TableOfContentsEntry {
	depth: number;
	value: string;
	id?: string;
	children?: Array<TableOfContentsEntry>;
}

export interface PreparedContent {
	tree: RichTextRoot;
	sections: Array<ContentSection>;
	tableOfContents: Array<TableOfContentsEntry>;
}

export interface ImageInfo {
	src: string;
	width: number | null;
	height: number | null;
}

export interface PrepareOptions {
	language: IntlLanguage;
	/** Translations for the footnotes section. */
	labels: { footnotes: string; footnoteBackLabel: (reference: string) => string };
	resolveImage: (media: string) => ImageInfo | null;
	/** Converts a link field value into the Keystatic shape the `Link` components expect. */
	resolveLink: (link: unknown) => unknown;
}

// -------------------------------------------------------------------------------------------------------------
// Tree helpers
// -------------------------------------------------------------------------------------------------------------

type AnyNode = BlockNode | InlineNode;

function getChildren(node: AnyNode | RichTextRoot): Array<AnyNode> {
	if (node.type === "list") {
		return node.children.flatMap((item) => item.children);
	}
	if (node.type === "table") {
		return node.children.flatMap((row) => row.children.flatMap((cell) => cell.children));
	}
	return "children" in node ? node.children : [];
}

function visit(node: AnyNode | RichTextRoot, visitor: (node: AnyNode) => void): void {
	for (const child of getChildren(node)) {
		visitor(child);
		visit(child, visitor);
	}
}

/** The text content, as `hast-util-to-string` would see it after rendering. */
function toText(nodes: ReadonlyArray<AnyNode>): string {
	return nodes
		.map((node) => {
			if (node.type === "text") {
				return node.value;
			}
			if (node.type === "component" && node.name === "FootnoteReference") {
				return String(node.props.index);
			}
			if (node.type === "code") {
				return node.value;
			}
			return toText(getChildren(node));
		})
		.join("");
}

function component(name: string, props: Record<string, unknown>, children: Array<BlockNode> = []): ComponentNode {
	return { type: "component", name, props, children };
}

function isFootnote(mark: Mark): mark is ComponentMark {
	return mark.type === "component" && mark.name === "Footnote";
}

// -------------------------------------------------------------------------------------------------------------
// Footnotes
// -------------------------------------------------------------------------------------------------------------

/**
 * Footnote marks become numbered references, and their text a footnotes section at the end, as `remark-gfm` rendered
 * them.
 */
function extractFootnotes(tree: RichTextRoot, options: PrepareOptions): void {
	const definitions: Array<Array<InlineNode>> = [];

	function withoutFootnote(node: TextNode): TextNode {
		const marks = (node.marks ?? []).filter((mark) => !isFootnote(mark));
		return marks.length > 0 ? { ...node, marks } : { type: "text", value: node.value };
	}

	/** Text and links inside a footnote carry its mark; links are nodes of their own, so they are checked separately. */
	function isInFootnote(node: InlineNode | undefined): boolean {
		if (node?.type === "text") {
			return node.marks?.some(isFootnote) === true;
		}
		if (node?.type === "link") {
			return node.children.length > 0 && node.children.every((child) => child.marks?.some(isFootnote) === true);
		}
		return false;
	}

	function processInlines(nodes: Array<InlineNode>): Array<InlineNode> {
		const result: Array<InlineNode> = [];
		let run: Array<InlineNode> | null = null;
		function flush(): void {
			if (run != null) {
				definitions.push(run);
				const index = definitions.length;
				result.push(component("FootnoteReference", { id: `fn-${String(index)}`, index }));
				run = null;
			}
		}
		nodes.forEach((node, index) => {
			if (isInFootnote(node)) {
				run ??= [];
				run.push(
					node.type === "link"
						? { ...node, children: node.children.map(withoutFootnote) }
						: withoutFootnote(node as TextNode),
				);
				return;
			}
			/** Footnotes of several paragraphs were joined with line breaks. */
			if (node.type === "break" && run != null && isInFootnote(nodes[index + 1])) {
				run.push(node);
				return;
			}
			flush();
			result.push(node);
		});
		flush();
		return result;
	}

	function processBlocks(nodes: Array<BlockNode>): void {
		for (const node of nodes) {
			if (node.type === "paragraph" || node.type === "heading") {
				node.children = processInlines(node.children);
			} else if (node.type === "table") {
				for (const row of node.children) {
					for (const cell of row.children) {
						cell.children = processInlines(cell.children);
					}
				}
			} else if (node.type === "list") {
				for (const item of node.children) {
					processBlocks(item.children);
				}
			} else if (node.type === "blockquote" || node.type === "component") {
				processBlocks(node.children);
			}
		}
	}

	processBlocks(tree.children);

	if (definitions.length > 0) {
		tree.children.push(
			component(
				"Footnotes",
				{ label: options.labels.footnotes },
				definitions.map((content, index) => {
					const id = `fn-${String(index + 1)}`;
					const backLink = component("FootnoteBackReference", {
						id,
						label: options.labels.footnoteBackLabel(String(index + 1)),
					}) as InlineNode;
					return component("FootnoteDefinition", { id }, [
						{ type: "paragraph", children: [...content, { type: "text", value: " " }, backLink] },
					]);
				}),
			),
		);
	}
}

// -------------------------------------------------------------------------------------------------------------
// Typographic quotes
// -------------------------------------------------------------------------------------------------------------

interface ProxyNode {
	type: string;
	value?: string;
	name?: string;
	children?: Array<ProxyNode>;
	source?: TextNode;
}

const typographicQuotesTransforms = new Map<IntlLanguage, (tree: unknown) => void>();

/** Creating the processors is expensive, so there is one per language. */
function getTypographicQuotesTransform(language: IntlLanguage): (tree: unknown) => void {
	let transform = typographicQuotesTransforms.get(language);
	if (transform == null) {
		transform = (withTypographicQuotes as (options: unknown) => (tree: unknown) => void)(
			typographyConfig[language as keyof typeof typographyConfig],
		);
		typographicQuotesTransforms.set(language, transform);
	}
	return transform;
}

/**
 * Runs `remark-smartypants` on a stand-in mdast tree, so quotes are paired across formatting and links exactly as
 * before.
 */
function applyTypographicQuotes(tree: RichTextRoot, language: IntlLanguage): void {
	function toProxy(node: AnyNode): ProxyNode {
		switch (node.type) {
			case "text": {
				const isCode = node.marks?.some((mark) => mark.type === "code") === true;
				return { type: isCode ? "inlineCode" : "text", value: node.value, source: node };
			}
			case "paragraph": {
				return { type: "paragraph", children: node.children.map(toProxy) };
			}
			case "heading": {
				return { type: "heading", children: node.children.map(toProxy) };
			}
			case "table": {
				return {
					type: "table",
					children: node.children.map((row) => {
						return {
							type: "tableRow",
							children: row.children.map((cell) => {
								return { type: "tableCell", children: cell.children.map(toProxy) };
							}),
						};
					}),
				};
			}
			case "list": {
				return {
					type: "list",
					children: node.children.map((item) => {
						return { type: "listItem", children: item.children.map(toProxy) };
					}),
				};
			}
			case "link": {
				return { type: "link", children: node.children.map(toProxy) };
			}
			case "component": {
				return { type: "mdxJsxFlowElement", name: node.name, children: node.children.map(toProxy) };
			}
			case "blockquote": {
				return { type: "blockquote", children: node.children.map(toProxy) };
			}
			case "break":
			case "code":
			case "divider": {
				return { type: node.type };
			}
		}
	}

	const proxy = { type: "root", children: tree.children.map(toProxy) };
	getTypographicQuotesTransform(language)(proxy);

	function copyBack(node: ProxyNode): void {
		if (node.source != null && node.type === "text") {
			node.source.value = node.value!;
		}
		node.children?.forEach(copyBack);
	}
	copyBack(proxy);
}

// -------------------------------------------------------------------------------------------------------------
// Quiz blanks
// -------------------------------------------------------------------------------------------------------------

const blankPattern = /@@(?<inner>[^@]+)@@/g;

/** `@@answer1//answer2::hint@@` in fill-in-the-blank and drag-the-words exercises. */
function applyBlanks(tree: RichTextRoot): void {
	visit(tree, (node) => {
		if (node.type !== "component" || (node.name !== "QuizFillInTheBlank" && node.name !== "QuizDragTheWords")) {
			return;
		}
		const isFillIn = node.name === "QuizFillInTheBlank";
		const answers: Array<unknown> = [];

		function split(nodes: Array<InlineNode>): Array<InlineNode> {
			return nodes.flatMap((child): Array<InlineNode> => {
				if (child.type !== "text" || !child.value.includes("@@")) {
					return [child];
				}
				const result: Array<InlineNode> = [];
				let last = 0;
				for (const match of child.value.matchAll(blankPattern)) {
					if (match.index > last) {
						result.push({ ...child, value: child.value.slice(last, match.index) });
					}
					const inner = match.groups!.inner!;
					const separator = inner.indexOf("::");
					const answerPart = separator === -1 ? inner : inner.slice(0, separator);
					const hint = separator === -1 ? undefined : inner.slice(separator + 2).trim() || undefined;
					const id = String(answers.length);
					if (isFillIn) {
						const values = answerPart
							.split("//")
							.map((value) => value.trim())
							.filter(Boolean);
						answers.push(values);
						result.push(component("Blank", { id, answer: values, hint }));
					} else {
						const value = answerPart.trim();
						answers.push(value);
						result.push(component("Drop", { id, answer: value, hint }));
					}
					last = match.index + match[0].length;
				}
				if (last < child.value.length) {
					result.push({ ...child, value: child.value.slice(last) });
				}
				return result;
			});
		}

		visit(node, (child) => {
			if (child.type === "paragraph" || child.type === "heading") {
				child.children = split(child.children);
			}
		});
		node.props = { ...node.props, blankCount: String(answers.length), answers };
	});
}

// -------------------------------------------------------------------------------------------------------------
// Paragraphs of only components
// -------------------------------------------------------------------------------------------------------------

function isWhitespace(node: InlineNode): boolean {
	return node.type === "text" && (node.marks ?? []).length === 0 && node.value.trim() === "";
}

/** Component marks only come from mdx elements, e.g. `<Link>`; markdown links are link nodes. */
function isFromElement(node: InlineNode): boolean {
	return node.type === "text" && node.marks?.[0]?.type === "component";
}

/**
 * Mdx renders a paragraph which only contains elements and whitespace as those elements, without the paragraph, e.g. a
 * `<Link>` on a line of its own. Such paragraphs become `Unraveled` blocks.
 *
 * @see https://github.com/mdx-js/mdx/blob/main/packages/mdx/lib/plugin/remark-mark-and-unravel.js
 */
function applyUnravel(tree: RichTextRoot): void {
	function process(nodes: Array<BlockNode>): Array<BlockNode> {
		return nodes.map((node) => {
			if (
				node.type === "paragraph" &&
				node.children.some(isFromElement) &&
				node.children.every((child) => isFromElement(child) || isWhitespace(child))
			) {
				return component("Unraveled", { content: node.children.filter((child) => !isWhitespace(child)) });
			}
			if (node.type === "list") {
				for (const item of node.children) {
					item.children = process(item.children);
				}
			}
			if (node.type === "blockquote" || node.type === "component") {
				node.children = process(node.children);
			}
			return node;
		});
	}
	tree.children = process(tree.children);
}

// -------------------------------------------------------------------------------------------------------------
// Headings, sections, table of contents
// -------------------------------------------------------------------------------------------------------------

/** Custom identifiers, else `rehype-slug`, which uses `github-slugger` and appends counters for duplicates. */
function applyHeadingIds(tree: RichTextRoot): void {
	const slugger = new GithubSlugger();
	visit(tree, (node) => {
		if (node.type === "heading") {
			node.id ??= slugger.slug(toText(node.children));
		}
	});
}

/** Iframes need a title; Keystatic took it from the caption. */
function applyIframeTitles(tree: RichTextRoot): void {
	visit(tree, (node) => {
		if (node.type === "component" && (node.name === "Embed" || node.name === "Video") && node.props.title == null) {
			node.props = { ...node.props, title: toText(node.children) };
		}
	});
}

function createUniqueId(id: string, used: Set<string>): string {
	if (!used.has(id)) {
		return id;
	}
	let suffix = 2;
	while (used.has(`${id}-${String(suffix)}`)) {
		suffix++;
	}
	return `${id}-${String(suffix)}`;
}

/** Splits at top-level split points into `ContentSection`s, as `withContentSections` did. */
function applySections(tree: RichTextRoot): Array<ContentSection> {
	/** Split points which are not top-level cannot split the document. */
	function removeNested(nodes: Array<BlockNode>): Array<BlockNode> {
		return nodes
			.filter((node) => !(node.type === "component" && node.name === "SplitPoint"))
			.map((node) => {
				if (node.type === "component" || node.type === "blockquote") {
					node.children = removeNested(node.children);
				}
				return node;
			});
	}

	interface Group {
		id: string | null;
		splitPoint: boolean;
		children: Array<BlockNode>;
	}
	const groups: Array<Group> = [{ id: null, splitPoint: false, children: [] }];
	for (const child of tree.children) {
		if (child.type === "component" && child.name === "SplitPoint") {
			const id = child.props.id;
			groups.push({ id: typeof id === "string" && id !== "" ? id : null, splitPoint: true, children: [] });
		} else {
			if (child.type === "component" || child.type === "blockquote") {
				child.children = removeNested(child.children);
			}
			groups.at(-1)!.children.push(child);
		}
	}
	if (groups.length === 1) {
		return [];
	}
	if (!groups[0]!.splitPoint && groups[0]!.children.length === 0) {
		groups.shift();
	}

	const used = new Set<string>();
	const ids = groups.map((group) => {
		if (group.id == null) {
			return null;
		}
		const id = createUniqueId(group.id, used);
		used.add(id);
		return id;
	});
	groups.forEach((_group, index) => {
		if (ids[index] == null) {
			const id = createUniqueId(`section-${String(index + 1)}`, used);
			used.add(id);
			ids[index] = id;
		}
	});

	const sections: Array<ContentSection> = [];
	tree.children = groups.map((group, index) => {
		const id = ids[index]!;
		const headingIds: Array<string> = [];
		let label: string | null = null;
		visit({ type: "root", children: group.children }, (node) => {
			if (node.type === "heading") {
				label ??= toText(node.children);
				if (node.id != null && node.id !== "") {
					headingIds.push(node.id);
				}
			}
			if (node.type === "component" && node.name === "Footnotes") {
				label ??= String(node.props.label);
				headingIds.push("footnote-label");
			}
		});
		sections.push({ id, label, headingIds });
		return component("ContentSection", { id }, group.children);
	});
	return sections;
}

function createTableOfContents(tree: RichTextRoot): Array<TableOfContentsEntry> {
	const headings: Array<TableOfContentsEntry> = [];
	visit(tree, (node) => {
		if (node.type === "heading") {
			/** Headings without text get an empty identifier, which the table of contents does not link to. */
			headings.push({
				depth: node.level,
				value: toText(node.children),
				...(node.id != null && node.id !== "" ? { id: node.id } : {}),
			});
		}
		if (node.type === "component" && node.name === "Footnotes") {
			headings.push({ depth: 2, value: String(node.props.label), id: "footnote-label" });
		}
	});

	const root: TableOfContentsEntry = { depth: 0, value: "", children: [] };
	const parents: Array<TableOfContentsEntry> = [];
	let previous = root;
	for (const heading of headings) {
		if (heading.depth > previous.depth) {
			previous.children ??= [];
			parents.push(previous);
		} else if (heading.depth < previous.depth) {
			while (parents.at(-1)!.depth >= heading.depth) {
				parents.pop();
			}
		}
		parents.at(-1)!.children!.push(heading);
		previous = heading;
	}
	return root.children!;
}

// -------------------------------------------------------------------------------------------------------------
// Props
// -------------------------------------------------------------------------------------------------------------

interface ImageValue {
	media: string;
	alt: string | null;
}

/** Components which got `width` and `height` from `withImageSizes`. */
const sizedComponents = new Set([
	"CarouselItem",
	"Figure",
	"ImageLayer",
	"QuizImageDropZones",
	"QuizImageHotspots",
	"VideoCard",
]);

function withoutNull(props: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(props).filter(([, value]) => value != null));
}

/** Props in the shape the mdx attributes had: image paths and alt text side by side, links as Keystatic values. */
function applyLegacyProps(tree: RichTextRoot, options: PrepareOptions): void {
	function convert(node: { name: string; props: Record<string, unknown> }): Record<string, unknown> {
		const { image, left, right, link, ...rest } = node.props as Record<string, unknown> & {
			image?: ImageValue | null;
			left?: ImageValue | null;
			right?: ImageValue | null;
		};
		const props: Record<string, unknown> = { ...rest };
		if (image != null) {
			const info = options.resolveImage(image.media);
			props.src = info?.src;
			props.alt = image.alt;
			if (sizedComponents.has(node.name) || node.name === "Image") {
				props.width = info?.width;
				props.height = info?.height;
			}
		}
		if (left != null) {
			props.left = options.resolveImage(left.media)?.src;
			props.leftAlt = left.alt;
		}
		if (right != null) {
			props.right = options.resolveImage(right.media)?.src;
			props.rightAlt = right.alt;
		}
		if (link !== undefined) {
			props.link = options.resolveLink(link);
		}
		return withoutNull(props);
	}

	visit(tree, (node) => {
		if (node.type === "component" && node.name === "Unraveled") {
			const content = node.props.content as Array<InlineNode>;
			visit({ type: "root", children: [{ type: "paragraph", children: content }] }, (child) => {
				convertNode(child);
			});
			return;
		}
		convertNode(node);
	});

	function convertNode(node: AnyNode): void {
		if (node.type === "component") {
			node.props = convert(node);
		}
		if (node.type === "text" && node.marks != null) {
			node.marks = node.marks
				.map((mark) => (mark.type === "component" ? { ...mark, props: convert(mark) } : mark))
				/** Links to entries which are not published, e.g. drafts, become plain text. */
				.filter((mark) => !(mark.type === "component" && mark.name === "Link" && mark.props.link == null));
			if (node.marks.length === 0) {
				delete node.marks;
			}
		}
	}
}

// -------------------------------------------------------------------------------------------------------------
// Pipeline
// -------------------------------------------------------------------------------------------------------------

export function prepareContent(value: RichTextRoot, options: PrepareOptions): PreparedContent {
	const tree = structuredClone(value);

	/** Remark phase. */
	extractFootnotes(tree, options);
	applyTypographicQuotes(tree, options.language);
	applyBlanks(tree);
	applyUnravel(tree);

	/** Rehype phase. */
	applyHeadingIds(tree);
	applyIframeTitles(tree);
	applyLegacyProps(tree, options);
	const sections = applySections(tree);
	const tableOfContents = createTableOfContents(tree);

	return { tree, sections, tableOfContents };
}
