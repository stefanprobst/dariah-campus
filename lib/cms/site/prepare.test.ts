import type { BlockNode, RichTextRoot } from "@stefanprobst/cms/rich-text";
import { describe, expect, it } from "vitest";

import { componentSets } from "#/lib/cms/components.ts";
import { type PrepareOptions, prepareContent } from "#/lib/cms/site/prepare.ts";

const options: PrepareOptions = {
	language: "en",
	labels: { footnotes: "Footnotes", footnoteBackLabel: (reference) => `Back to reference ${reference}` },
	resolveImage: (media) => {
		return { src: `/media/${media}`, width: 100, height: 50 };
	},
	resolveLink: (link) => {
		return { legacy: link };
	},
};

function root(...children: Array<BlockNode>): RichTextRoot {
	return { type: "root", children };
}

function paragraph(text: string): BlockNode {
	return { type: "paragraph", children: [{ type: "text", value: text }] };
}

function heading(text: string, level: 2 | 3 = 2, id: string | null = null): BlockNode {
	return { type: "heading", level, id, children: [{ type: "text", value: text }] };
}

describe("prepareContent", () => {
	it("knows every component of the schema", () => {
		expect(
			new Set(
				Object.values(componentSets)
					.flat()
					.map((component) => component.name),
			).size,
		).toBeGreaterThan(20);
	});

	it("uses typographic quotes across formatting", () => {
		const { tree } = prepareContent(
			root({
				type: "paragraph",
				children: [
					{ type: "text", value: "He said \"it's " },
					{ type: "text", value: "fine", marks: [{ type: "bold" }] },
					{ type: "text", value: '" and left; `"code"`' },
					{ type: "text", value: '"x"', marks: [{ type: "code" }] },
				],
			}),
			options,
		);

		expect(tree.children[0]).toEqual({
			type: "paragraph",
			children: [
				{ type: "text", value: "He said “it’s " },
				{ type: "text", value: "fine", marks: [{ type: "bold" }] },
				{ type: "text", value: "” and left; `“code”`" },
				{ type: "text", value: '"x"', marks: [{ type: "code" }] },
			],
		});
	});

	it("assigns heading identifiers and builds the table of contents", () => {
		const { tableOfContents, tree } = prepareContent(
			root(heading("Intro"), heading("Details", 3), heading("Intro"), heading("Custom", 2, "custom")),
			options,
		);

		expect(tree.children.map((node) => (node.type === "heading" ? node.id : null))).toEqual([
			"intro",
			"details",
			"intro-1",
			"custom",
		]);
		expect(tableOfContents).toEqual([
			{ depth: 2, value: "Intro", id: "intro", children: [{ depth: 3, value: "Details", id: "details" }] },
			{ depth: 2, value: "Intro", id: "intro-1" },
			{ depth: 2, value: "Custom", id: "custom" },
		]);
	});

	it("turns footnote marks into references and a footnotes section", () => {
		const footnote = { type: "component" as const, name: "Footnote", props: {} };
		const { tableOfContents, tree } = prepareContent(
			root({
				type: "paragraph",
				children: [
					{ type: "text", value: "Text" },
					{ type: "text", value: "A ", marks: [footnote] },
					{ type: "text", value: "note", marks: [footnote, { type: "italic" }] },
					{ type: "text", value: "." },
				],
			}),
			options,
		);

		expect(tree.children).toEqual([
			{
				type: "paragraph",
				children: [
					{ type: "text", value: "Text" },
					{ type: "component", name: "FootnoteReference", props: { id: "fn-1", index: 1 }, children: [] },
					{ type: "text", value: "." },
				],
			},
			{
				type: "component",
				name: "Footnotes",
				props: { label: "Footnotes" },
				children: [
					{
						type: "component",
						name: "FootnoteDefinition",
						props: { id: "fn-1" },
						children: [
							{
								type: "paragraph",
								children: [
									{ type: "text", value: "A " },
									{ type: "text", value: "note", marks: [{ type: "italic" }] },
									{ type: "text", value: " " },
									{
										type: "component",
										name: "FootnoteBackReference",
										props: { id: "fn-1", label: "Back to reference 1" },
										children: [],
									},
								],
							},
						],
					},
				],
			},
		]);
		expect(tableOfContents).toEqual([{ depth: 2, value: "Footnotes", id: "footnote-label" }]);
	});

	it("splits content into sections at split points", () => {
		const splitPoint = (id: string | null): BlockNode => {
			return {
				type: "component",
				name: "SplitPoint",
				props: { id },
				children: [],
			};
		};
		const { sections, tree } = prepareContent(
			root(paragraph("Before"), splitPoint("first"), heading("One"), splitPoint(null), heading("Two")),
			options,
		);

		expect(sections).toEqual([
			{ id: "section-1", label: null, headingIds: [] },
			{ id: "first", label: "One", headingIds: ["one"] },
			{ id: "section-3", label: "Two", headingIds: ["two"] },
		]);
		expect(tree.children.map((node) => (node.type === "component" ? node.props.id : null))).toEqual([
			"section-1",
			"first",
			"section-3",
		]);
	});

	it("turns blanks into blank components", () => {
		const { tree } = prepareContent(
			root({
				type: "component",
				name: "QuizFillInTheBlank",
				props: { caseSensitive: false, validateOnBlur: false },
				children: [paragraph("Capital: @@Paris//paris::city@@!")],
			}),
			options,
		);

		expect(tree.children[0]).toEqual({
			type: "component",
			name: "QuizFillInTheBlank",
			props: { caseSensitive: false, validateOnBlur: false, blankCount: "1", answers: [["Paris", "paris"]] },
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "Capital: " },
						{
							type: "component",
							name: "Blank",
							props: { id: "0", answer: ["Paris", "paris"], hint: "city" },
							children: [],
						},
						{ type: "text", value: "!" },
					],
				},
			],
		});
	});

	it("brings props into the shape of the former mdx attributes", () => {
		const { tree } = prepareContent(
			root({
				type: "component",
				name: "Figure",
				props: { image: { media: "m1", alt: null, decorative: false }, alignment: "center" },
				children: [paragraph("Caption")],
			}),
			options,
		);

		expect(tree.children[0]).toMatchObject({
			name: "Figure",
			props: { src: "/media/m1", width: 100, height: 50, alignment: "center" },
		});
	});
});
