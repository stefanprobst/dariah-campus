import {
	transformerNotationDiff,
	transformerNotationHighlight,
	transformerNotationWordHighlight,
} from "@shikijs/transformers";
import type { InlineNode, RichTextRoot } from "@stefanprobst/cms/rich-text";
import {
	type ComponentRenderer,
	type ElementRenderers,
	type Renderers,
	RichText,
	createRenderers,
	defineRenderer,
} from "@stefanprobst/cms/rich-text/react";
import { type AnyComponent, component } from "@stefanprobst/cms/schema";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Children, type ComponentType, type ReactNode, isValidElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { codeToHast } from "shiki";

import { Callout } from "#/components/content/callout.tsx";
import { Carousel, CarouselItem } from "#/components/content/carousel.tsx";
import { ContentSection } from "#/components/content/content-section.tsx";
import { Diagram, DiagramCaption, DiagramCodeBlock } from "#/components/content/diagram.tsx";
import { Disclosure } from "#/components/content/disclosure.tsx";
import { Drop, QuizDragTheWords } from "#/components/content/drag-the-words.tsx";
import { Embed } from "#/components/content/embed.tsx";
import { ExternalResource } from "#/components/content/external-resource.tsx";
import { Figure } from "#/components/content/figure.tsx";
import { Blank, QuizFillInTheBlank } from "#/components/content/fill-in-the-blank.tsx";
import { Grid, GridItem } from "#/components/content/grid.tsx";
import { ImageComparisonSlider } from "#/components/content/image-comparison-slider.tsx";
import { QuizImageDropZone, QuizImageDropZones } from "#/components/content/image-drop-zones.tsx";
import { ImageLayer, ImageLayers } from "#/components/content/image-layers.tsx";
import { Language, LanguageBlock } from "#/components/content/language.tsx";
import { LinkButton } from "#/components/content/link-button.tsx";
import { Link as ContentLink } from "#/components/content/link.tsx";
import { QuizMatching, QuizMatchingZone } from "#/components/content/matching.tsx";
import { MermaidDiagram } from "#/components/content/mermaid-diagram.tsx";
import { QuizOrdering, QuizOrderingItem } from "#/components/content/ordering.tsx";
import {
	QuizChoice,
	QuizChoiceAnswer,
	QuizChoiceAnswerErrorMessage,
	QuizChoiceAnswerLabel,
	QuizChoiceQuestion,
} from "#/components/content/quiz-choice.tsx";
import { QuizImageHotspot, QuizImageHotspots } from "#/components/content/quiz-image-hotspots.tsx";
import { QuizQuestion } from "#/components/content/quiz-question.tsx";
import { Quiz, QuizErrorMessage, QuizSuccessMessage } from "#/components/content/quiz.tsx";
import { Tab, Tabs } from "#/components/content/tabs.tsx";
import { VideoCard } from "#/components/content/video-card.tsx";
import { Video } from "#/components/content/video.tsx";
import {
	Worksheet,
	WorksheetDescription,
	WorksheetQuestion,
	WorksheetSection,
	WorksheetSectionDescription,
} from "#/components/content/worksheet.tsx";
import { Image } from "#/components/image.tsx";
import { Link } from "#/components/link.tsx";
import * as components from "#/lib/cms/components.ts";

/**
 * Renders prepared rich text (see `prepare.ts`) with the content components of the mdx pipeline. Props were brought
 * into the shape of the mdx attributes, so the components are used as they are.
 */

/** The content components take the mdx attributes, not the schema props, so renderers are not typed by the schema. */
function legacy(definition: AnyComponent, render: ComponentType<never>): ComponentRenderer {
	return defineRenderer(definition, render as never);
}

// -------------------------------------------------------------------------------------------------------------
// Site-only components, inserted by `prepare.ts`
// -------------------------------------------------------------------------------------------------------------

const siteComponents = {
	blank: component.inline({ name: "Blank", label: "Blank" }),
	drop: component.inline({ name: "Drop", label: "Drop" }),
	contentSection: component.wrapper({ name: "ContentSection", label: "Section" }),
	footnoteReference: component.inline({ name: "FootnoteReference", label: "Footnote reference" }),
	footnoteBackReference: component.inline({ name: "FootnoteBackReference", label: "Footnote back reference" }),
	footnoteDefinition: component.wrapper({ name: "FootnoteDefinition", label: "Footnote" }),
	footnotes: component.repeating({ name: "Footnotes", label: "Footnotes", children: { allowed: [] } }),
	unraveled: component.block({ name: "Unraveled", label: "Paragraph of elements" }),
};

/** Class names of gfm footnotes, which styles may refer to. */
const footnoteBackReferenceClassName = "data-footnote-backref";
const footnotesClassName = "footnotes";

/** As `mdast-util-to-hast` renders gfm footnotes. */
function FootnoteReference(props: { id: string; index: number }): ReactNode {
	return (
		<sup>
			<Link
				aria-describedby="footnote-label"
				data-footnote-ref={true}
				href={`#user-content-fn-${props.id}`}
				id={`user-content-fnref-${props.id}`}
			>
				{String(props.index)}
			</Link>
		</sup>
	);
}

function FootnoteBackReference(props: { id: string; label: string }): ReactNode {
	return (
		<Link
			aria-label={props.label}
			className={footnoteBackReferenceClassName}
			data-footnote-backref=""
			href={`#user-content-fnref-${props.id}`}
		>
			↩
		</Link>
	);
}

function FootnoteDefinition(props: { id: string; children?: ReactNode }): ReactNode {
	return <li id={`user-content-fn-${props.id}`}>{props.children}</li>;
}

function Footnotes(props: { label: string; children?: ReactNode }): ReactNode {
	return (
		<section className={footnotesClassName} data-footnotes={true}>
			<h2 className="" id="footnote-label">
				{props.label}
			</h2>
			<ol>{props.children}</ol>
		</section>
	);
}

/** A markdown image, rendered as the `img` element of the mdx pipeline. */
function InlineImage(props: {
	src?: string;
	alt?: string;
	title?: string;
	width?: number;
	height?: number;
}): ReactNode {
	const { alt = "", height, src, title, width } = props;
	if (src == null) {
		return null;
	}
	return <Image alt={alt} height={height} src={src} title={title} width={width} />;
}

// -------------------------------------------------------------------------------------------------------------
// Elements
// -------------------------------------------------------------------------------------------------------------

function Paragraph(props: { children?: ReactNode }): ReactNode {
	return <p>{props.children}</p>;
}

/** Link buttons render their text inline, as `withUnwrappedMdxFlowContent` did. */
function UnwrappedLinkButton(props: { children?: ReactNode } & Record<string, unknown>): ReactNode {
	const { children, ...rest } = props;
	const unwrapped = Children.map(children, (child) => {
		if (isValidElement<{ children?: ReactNode }>(child) && child.type === Paragraph) {
			return <span>{child.props.children}</span>;
		}
		return child;
	});
	const Button = LinkButton as ComponentType<Record<string, unknown>>;
	return <Button {...rest}>{unwrapped}</Button>;
}

const syntaxHighlighterTransformers = [
	transformerNotationDiff({ matchAlgorithm: "v3" }),
	transformerNotationHighlight({ matchAlgorithm: "v3" }),
	transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
];

async function highlight(value: string, language: string) {
	return codeToHast(value, {
		lang: language,
		themes: { light: "github-light" },
		defaultColor: "light",
		transformers: syntaxHighlighterTransformers,
	});
}

/** Mermaid diagrams, else syntax highlighting with the configuration of `createSyntaxHighlighterPlugin`. */
async function Code(props: { language: string | null; value: string }): Promise<ReactNode> {
	if (props.language === "mermaid") {
		return <MermaidDiagram diagram={props.value} />;
	}
	let tree;
	try {
		tree = await highlight(props.value, props.language ?? "text");
	} catch {
		tree = await highlight(props.value, "text");
	}
	return toJsxRuntime(tree, { Fragment, jsx, jsxs });
}

const elements: Partial<Omit<ElementRenderers, "marks">> = {
	paragraph: Paragraph,
	code: Code,
	link: (props) => <Link href={props.href}>{props.children}</Link>,
};

// -------------------------------------------------------------------------------------------------------------
// Renderers
// -------------------------------------------------------------------------------------------------------------

const defaultRenderers: Array<ComponentRenderer> = [
	legacy(components.callout, Callout),
	legacy(components.carousel, Carousel),
	legacy(components.carouselItem, CarouselItem),
	legacy(components.diagram, Diagram),
	legacy(components.diagramCaption, DiagramCaption),
	legacy(components.diagramCodeBlock, DiagramCodeBlock),
	legacy(components.disclosure, Disclosure),
	legacy(components.embed, Embed),
	legacy(components.externalResource, ExternalResource),
	legacy(components.figure, Figure),
	/** Footnote marks become references and a footnotes section in `prepare.ts`. */
	legacy(components.footnote, Fragment),
	legacy(components.grid, Grid),
	legacy(components.gridItem, GridItem),
	legacy(components.imageComparisonSlider, ImageComparisonSlider),
	legacy(components.imageLayer, ImageLayer),
	legacy(components.imageLayers, ImageLayers),
	legacy(components.inlineImage, InlineImage),
	legacy(components.language, Language),
	legacy(components.languageBlock, LanguageBlock),
	legacy(components.link, ContentLink),
	legacy(components.linkButton, UnwrappedLinkButton),
	legacy(components.quiz, Quiz),
	legacy(components.quizChoice, QuizChoice),
	legacy(components.quizChoiceAnswer, QuizChoiceAnswer),
	legacy(components.quizChoiceAnswerErrorMessage, QuizChoiceAnswerErrorMessage),
	legacy(components.quizChoiceAnswerLabel, QuizChoiceAnswerLabel),
	legacy(components.quizChoiceQuestion, QuizChoiceQuestion),
	legacy(components.quizDragTheWords, QuizDragTheWords),
	legacy(components.quizErrorMessage, QuizErrorMessage),
	legacy(components.quizFillInTheBlank, QuizFillInTheBlank),
	legacy(components.quizImageDropZone, QuizImageDropZone),
	legacy(components.quizImageDropZones, QuizImageDropZones),
	legacy(components.quizImageHotspot, QuizImageHotspot),
	legacy(components.quizImageHotspots, QuizImageHotspots),
	legacy(components.quizMatching, QuizMatching),
	legacy(components.quizMatchingZone, QuizMatchingZone),
	legacy(components.quizOrdering, QuizOrdering),
	legacy(components.quizOrderingItem, QuizOrderingItem),
	legacy(components.quizQuestion, QuizQuestion),
	legacy(components.quizSuccessMessage, QuizSuccessMessage),
	/** Split points are removed by `prepare.ts`. */
	legacy(components.splitPoint, () => null),
	legacy(components.tab, Tab),
	legacy(components.tabs, Tabs),
	legacy(components.video, Video),
	legacy(components.videoCard, VideoCard),
	legacy(components.worksheet, Worksheet),
	legacy(components.worksheetDescription, WorksheetDescription),
	legacy(components.worksheetQuestion, WorksheetQuestion),
	legacy(components.worksheetSection, WorksheetSection),
	legacy(components.worksheetSectionDescription, WorksheetSectionDescription),
	legacy(siteComponents.blank, Blank),
	legacy(siteComponents.drop, Drop),
	legacy(siteComponents.contentSection, ContentSection),
	legacy(siteComponents.footnoteReference, FootnoteReference),
	legacy(siteComponents.footnoteBackReference, FootnoteBackReference),
	legacy(siteComponents.footnoteDefinition, FootnoteDefinition),
	legacy(siteComponents.footnotes, Footnotes),
];

/** Every component with a renderer, for a test which checks that none is missing. */
export const renderedComponents = defaultRenderers.map((renderer) => renderer.component.name);

const renderersByName = new Map(defaultRenderers.map((renderer) => [renderer.component.name, renderer]));

export interface ContentProps {
	/** Replaces renderers by component name, e.g. `ContentSection` to render a single section. */
	components?: Record<string, ComponentType<never>>;
}

/** A component which renders prepared content, used where the mdx pipeline provided a compiled module. */
/** Takes a function, so the tree is only prepared when the content is rendered. */
export function createContent(getTree: () => RichTextRoot): (props: ContentProps) => ReactNode {
	return function Content(props: ContentProps): ReactNode {
		const tree = getTree();
		const overrides = Object.entries(props.components ?? {}).map(([name, render]) => {
			const renderer = renderersByName.get(name);
			if (renderer == null) {
				throw new Error(`No renderer for "${name}".`);
			}
			return legacy(renderer.component, render);
		});
		const names = new Set(overrides.map((renderer) => renderer.component.name));
		/** The renderer for `Unraveled` renders with all renderers, itself included. */
		const context: { renderers: Renderers | null } = { renderers: null };
		/** Renders the inline content of a paragraph without the paragraph, see `applyUnravel` in `prepare.ts`. */
		const unraveled = legacy(siteComponents.unraveled, (unraveledProps: { content: Array<InlineNode> }) => (
			<RichText
				elements={{ ...elements, paragraph: Fragment }}
				renderers={context.renderers!}
				value={{ type: "root", children: [{ type: "paragraph", children: unraveledProps.content }] }}
			/>
		));
		const renderers = createRenderers([
			...defaultRenderers.filter((renderer) => !names.has(renderer.component.name)),
			unraveled,
			...overrides,
		]);
		context.renderers = renderers;
		return <RichText elements={elements} renderers={renderers} value={tree} />;
	};
}
