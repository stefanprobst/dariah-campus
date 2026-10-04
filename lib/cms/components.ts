import { component, fields } from "@stefanprobst/cms/schema";

import {
	calloutKinds,
	figureAlignments,
	gridAlignments,
	gridLayouts,
	inlineLanguages,
	videoProviders,
} from "#/lib/content/options.ts";

/**
 * Content components, ported from the Keystatic components in `lib/content/keystatic/components`. Wrappers inherit the
 * content their surrounding field allows, as they did in Keystatic.
 */

/** Images placed in content. Alt text is optional, as it was in Keystatic; empty means none was written. */
function image(label: string) {
	return fields.image({ label, required: true, alt: "optional" });
}

const videoId = /^(?!https?:\/\/)/;

const position = (label: string, description?: string) =>
	fields.number({ label, ...(description != null ? { description } : {}), step: 0.1, min: 0, max: 100 });

const itemList = (label: string, description: string) =>
	fields.array(fields.object({ label: fields.text({ label: "Item", required: true }) }, { label: "Item" }), {
		label,
		description,
		itemLabel: (item) => item.label,
	});

// -------------------------------------------------------------------------------------------------------------
// Links
// -------------------------------------------------------------------------------------------------------------

export const linkTargets = [
	"resources-events",
	"resources-external",
	"resources-hosted",
	"resources-pathfinders",
	"curricula",
	"documentation",
] as const;

export const linkField = fields.link({
	label: "Link",
	required: true,
	kinds: ["external", "hash", "download", "email", "search"],
	entries: linkTargets,
});

export const link = component.mark({ name: "Link", label: "Link", props: { link: linkField } });

export const linkButton = component.wrapper({
	name: "LinkButton",
	label: "Link button",
	description: "Insert a link, which looks like a button.",
	props: { link: linkField },
});

// -------------------------------------------------------------------------------------------------------------
// Text
// -------------------------------------------------------------------------------------------------------------

export const callout = component.wrapper({
	name: "Callout",
	label: "Callout",
	description: "Insert a note, tip, warning, or error.",
	props: {
		kind: fields.select({ label: "Kind", options: calloutKinds, defaultValue: "note" }),
		title: fields.text({ label: "Title" }),
	},
});

export const disclosure = component.wrapper({
	name: "Disclosure",
	label: "Disclosure",
	description: "Insert text hidden behind a toggle.",
	props: { title: fields.text({ label: "Title", required: true }) },
});

export const footnote = component.mark({ name: "Footnote", label: "Footnote" });

export const language = component.mark({
	name: "Language",
	label: "Language",
	props: { lang: fields.select({ label: "Language", options: inlineLanguages, defaultValue: "en" }) },
});

export const languageBlock = component.wrapper({
	name: "LanguageBlock",
	label: "Language block",
	description: "Insert content written in a different language.",
	props: { lang: fields.select({ label: "Language", options: inlineLanguages, defaultValue: "en" }) },
});

export const splitPoint = component.block({
	name: "SplitPoint",
	label: "Split point",
	description: "Start a new section.",
	props: {
		id: fields.text({
			label: "ID",
			description:
				'Identifies the section in the page url, e.g. "?section=getting-started". Generated when left empty, but then changes whenever a section is inserted before it.',
			pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			patternMessage: "Must only contain lowercase letters, digits, and dashes.",
		}),
	},
});

export const tab = component.wrapper({
	name: "Tab",
	label: "Tab",
	props: { title: fields.text({ label: "Title", required: true }) },
});

export const tabs = component.repeating({
	name: "Tabs",
	label: "Tabs",
	description: "Insert tabs.",
	children: { allowed: [tab] },
});

export const gridItem = component.wrapper({
	name: "GridItem",
	label: "Grid item",
	props: {
		alignment: fields.select({ label: "Vertical alignment", options: gridAlignments, defaultValue: "stretch" }),
	},
});

export const grid = component.repeating({
	name: "Grid",
	label: "Grid",
	description: "Insert a layout grid.",
	props: {
		layout: fields.select({ label: "Layout", options: gridLayouts, defaultValue: "two-columns" }),
		alignment: fields.select({ label: "Vertical alignment", options: gridAlignments, defaultValue: "stretch" }),
	},
	children: { allowed: [gridItem] },
});

// -------------------------------------------------------------------------------------------------------------
// Media
// -------------------------------------------------------------------------------------------------------------

/** A markdown image. Most stand alone in a paragraph; some are inline icons. */
export const inlineImage = component.inline({
	name: "Image",
	label: "Image",
	props: {
		image: image("Image"),
		title: fields.text({ label: "Title", description: "Shown as tooltip." }),
	},
});

export const figure = component.wrapper({
	name: "Figure",
	label: "Figure",
	description: "Insert an image with caption.",
	props: {
		image: image("Image"),
		alignment: fields.select({ label: "Alignment", options: figureAlignments, defaultValue: "stretch" }),
	},
});

export const carouselItem = component.wrapper({
	name: "CarouselItem",
	label: "Carousel slide",
	props: { image: image("Image") },
});

export const carousel = component.repeating({
	name: "Carousel",
	label: "Carousel",
	description: "Insert a carousel.",
	props: {
		label: fields.text({
			label: "Label",
			description: 'Accessible name, announced by screen readers. Should not include the word "carousel".',
		}),
		loop: fields.checkbox({
			label: "Loop",
			description: "Continue from the last slide back to the first slide.",
			defaultValue: false,
		}),
	},
	children: { allowed: [carouselItem], min: 1 },
});

export const imageComparisonSlider = component.wrapper({
	name: "ImageComparisonSlider",
	label: "Image comparison slider",
	description: "Insert a slider to compare two images.",
	props: {
		left: image("Left image"),
		right: image("Right image"),
		orientation: fields.select({
			label: "Orientation",
			options: [
				{ value: "horizontal", label: "Horizontal" },
				{ value: "vertical", label: "Vertical" },
			],
			defaultValue: "horizontal",
		}),
	},
});

export const imageLayer = component.block({
	name: "ImageLayer",
	label: "Image layer",
	description: "The first layer serves as base image.",
	props: {
		image: image("Image"),
		label: fields.text({
			label: "Layer name",
			description: "Identifies the layer when it is selected with the slider. Defaults to the layer's position.",
		}),
	},
});

export const imageLayers = component.repeating({
	name: "ImageLayers",
	label: "Image layers",
	description: "Insert stacked images revealed with a slider.",
	props: { label: fields.text({ label: "Label", description: "Accessible name for the slider, displayed above it." }) },
	children: { allowed: [imageLayer], min: 2 },
});

export const embed = component.wrapper({
	name: "Embed",
	label: "Embed",
	description: "Insert content from another website.",
	props: { src: fields.url({ label: "URL", required: true }) },
});

const videoProps = {
	provider: fields.select({ label: "Provider", options: videoProviders, defaultValue: "youtube" }),
	id: fields.text({
		label: "Video ID",
		pattern: videoId,
		patternMessage: "Must only include the id, not the full URL.",
	}),
	startTime: fields.number({ label: "Start time" }),
};

export const video = component.wrapper({
	name: "Video",
	label: "Video",
	description: "Insert a video.",
	props: videoProps,
});

export const videoCard = component.block({
	name: "VideoCard",
	label: "Video card",
	description: "Insert a video card.",
	props: {
		...videoProps,
		title: fields.text({ label: "Title", required: true }),
		subtitle: fields.text({ label: "Subtitle" }),
		image: image("Image"),
	},
});

export const externalResource = component.block({
	name: "ExternalResource",
	label: "External resource",
	description: "Insert a link to an external resource.",
	props: {
		title: fields.text({ label: "Title", required: true }),
		subtitle: fields.text({ label: "Subtitle", required: true }),
		url: fields.url({ label: "URL", required: true }),
	},
});

export const diagramCodeBlock = component.wrapper({ name: "DiagramCodeBlock", label: "Code block" });
export const diagramCaption = component.wrapper({ name: "DiagramCaption", label: "Caption" });

export const diagram = component.repeating({
	name: "Diagram",
	label: "Diagram",
	description: "Insert a diagram with caption.",
	props: {
		link: fields.checkbox({
			label: "Add link to caption",
			description: "Include a link to open the graphic in a separate tab.",
			defaultValue: false,
		}),
	},
	children: { allowed: [diagramCodeBlock, diagramCaption], min: 1, max: 2 },
});

// -------------------------------------------------------------------------------------------------------------
// Worksheet
// -------------------------------------------------------------------------------------------------------------

export const worksheetQuestion = component.block({
	name: "WorksheetQuestion",
	label: "Worksheet question",
	props: {
		label: fields.text({ label: "Prompt", required: true }),
		description: fields.text({ label: "Helper text", multiline: true }),
		variant: fields.select({
			label: "Input type",
			options: [
				{ label: "Multiple lines", value: "long" },
				{ label: "Single line", value: "short" },
			],
			defaultValue: "long",
		}),
		placeholder: fields.text({ label: "Placeholder" }),
	},
});

export const worksheetSectionDescription = component.wrapper({
	name: "WorksheetSectionDescription",
	label: "Section introduction",
});

export const worksheetSection = component.repeating({
	name: "WorksheetSection",
	label: "Worksheet section",
	props: { title: fields.text({ label: "Section title", required: true }) },
	children: { allowed: [worksheetSectionDescription, worksheetQuestion], min: 1 },
});

export const worksheetDescription = component.wrapper({ name: "WorksheetDescription", label: "Introduction" });

export const worksheet = component.repeating({
	name: "Worksheet",
	label: "Worksheet",
	description: "Insert a form learners fill in and download.",
	props: { title: fields.text({ label: "Document title", required: true }) },
	children: { allowed: [worksheetDescription, worksheetSection], min: 1 },
});

// -------------------------------------------------------------------------------------------------------------
// Quiz
// -------------------------------------------------------------------------------------------------------------

export const quizQuestion = component.wrapper({ name: "QuizQuestion", label: "Question" });
export const quizChoiceQuestion = component.wrapper({ name: "QuizChoiceQuestion", label: "Question" });
export const quizSuccessMessage = component.wrapper({ name: "QuizSuccessMessage", label: "Success message" });
export const quizErrorMessage = component.wrapper({ name: "QuizErrorMessage", label: "Error message" });
export const quizChoiceAnswerLabel = component.wrapper({ name: "QuizChoiceAnswerLabel", label: "Answer text" });
export const quizChoiceAnswerErrorMessage = component.wrapper({
	name: "QuizChoiceAnswerErrorMessage",
	label: "Answer error message",
});

export const quizChoiceAnswer = component.repeating({
	name: "QuizChoiceAnswer",
	label: "Answer",
	props: {
		kind: fields.select({
			label: "Kind",
			options: [
				{ label: "Correct", value: "correct" },
				{ label: "Incorrect", value: "incorrect" },
			],
			defaultValue: "incorrect",
		}),
	},
	children: { allowed: [quizChoiceAnswerLabel, quizChoiceAnswerErrorMessage], min: 1, max: 2 },
});

export const quizChoice = component.repeating({
	name: "QuizChoice",
	label: "Multiple choice",
	props: {
		variant: fields.select({
			label: "Variant",
			options: [
				{ label: "Single correct answer", value: "single" },
				{ label: "Multiple correct answers", value: "multiple" },
			],
			defaultValue: "multiple",
		}),
		buttonLabel: fields.text({ label: "Button label", description: "Custom label for 'Check answer' button." }),
	},
	children: { allowed: [quizChoiceQuestion, quizChoiceAnswer, quizSuccessMessage, quizErrorMessage], min: 1 },
});

export const quizImageHotspot = component.wrapper({
	name: "QuizImageHotspot",
	label: "Image hotspot",
	editChildrenIn: "dialog",
	props: {
		label: fields.text({ label: "Hotspot label", required: true }),
		x: fields.number({
			label: "Horizontal position (%)",
			required: true,
			defaultValue: 50,
			step: 0.1,
			min: 0,
			max: 100,
		}),
		y: fields.number({ label: "Vertical position (%)", required: true, defaultValue: 50, step: 0.1, min: 0, max: 100 }),
	},
});

export const quizImageHotspots = component.repeating({
	name: "QuizImageHotspots",
	label: "Image hotspots",
	props: {
		image: image("Image"),
		presentation: fields.select({
			label: "Hotspot content presentation",
			options: [
				{ label: "Inline panel", value: "inline" },
				{ label: "Modal side panel", value: "sidepanel" },
				{ label: "Anchored popover", value: "popover" },
			],
			defaultValue: "inline",
		}),
	},
	children: { allowed: [quizQuestion, quizImageHotspot], min: 1 },
});

export const quizFillInTheBlank = component.wrapper({
	name: "QuizFillInTheBlank",
	label: "Fill in the blank",
	props: {
		caseSensitive: fields.checkbox({ label: "Case sensitive", defaultValue: false }),
		validateOnBlur: fields.checkbox({ label: "Validate on blur", defaultValue: false }),
	},
});

export const quizDragTheWords = component.wrapper({
	name: "QuizDragTheWords",
	label: "Drag the words",
	props: {
		caseSensitive: fields.checkbox({ label: "Case sensitive", defaultValue: false }),
		distractors: fields.array(fields.text({ label: "Word", required: true }), {
			label: "Distractors",
			itemLabel: (item) => item,
		}),
		instantFeedback: fields.checkbox({ label: "Instant feedback", defaultValue: false }),
	},
});

export const quizImageDropZone = component.wrapper({
	name: "QuizImageDropZone",
	label: "Drop zone",
	editChildrenIn: "dialog",
	props: {
		label: fields.text({ label: "Drop zone label" }),
		shape: fields.select({
			label: "Shape",
			options: [
				{ label: "Rectangle", value: "rectangle" },
				{ label: "Ellipse", value: "ellipse" },
			],
			defaultValue: "rectangle",
		}),
		items: itemList("Correct items", "The items which belong in this drop zone."),
		x: position("Horizontal position (%)", "From the image's left edge."),
		y: position("Vertical position (%)", "From the image's top edge."),
		width: position("Width (%)", "Share of the image's width."),
		height: position("Height (%)", "Share of the image's height."),
	},
});

export const quizImageDropZones = component.repeating({
	name: "QuizImageDropZones",
	label: "Image drop zones",
	props: {
		image: image("Background image"),
		distractors: itemList("Distractors", "Extra items which belong in no drop zone."),
		instantFeedback: fields.checkbox({ label: "Instant feedback", defaultValue: false }),
	},
	children: { allowed: [quizQuestion, quizImageDropZone], min: 1 },
});

export const quizMatchingZone = component.wrapper({
	name: "QuizMatchingZone",
	label: "Zone",
	editChildrenIn: "dialog",
	props: {
		label: fields.text({ label: "Zone label" }),
		items: itemList("Correct items", "The items which belong in this zone."),
	},
});

export const quizMatching = component.repeating({
	name: "QuizMatching",
	label: "Matching",
	props: {
		orderedZones: fields.checkbox({ label: "Ordered zones", defaultValue: false }),
		distractors: itemList("Distractors", "Extra items which belong in no zone."),
		instantFeedback: fields.checkbox({ label: "Instant feedback", defaultValue: false }),
	},
	children: { allowed: [quizQuestion, quizMatchingZone], min: 1 },
});

export const quizOrderingItem = component.wrapper({
	name: "QuizOrderingItem",
	label: "Item",
	editChildrenIn: "dialog",
	props: { label: fields.text({ label: "Item", description: "The text on the card.", required: true }) },
});

export const quizOrdering = component.repeating({
	name: "QuizOrdering",
	label: "Ordering",
	props: { instantFeedback: fields.checkbox({ label: "Instant feedback", defaultValue: false }) },
	children: { allowed: [quizQuestion, quizOrderingItem], min: 1 },
});

export const quiz = component.repeating({
	name: "Quiz",
	label: "Quiz",
	description: "An interactive quiz.",
	children: {
		allowed: [
			quizChoice,
			quizImageHotspots,
			quizFillInTheBlank,
			quizDragTheWords,
			quizImageDropZones,
			quizMatching,
			quizOrdering,
		],
	},
});

// -------------------------------------------------------------------------------------------------------------
// Sets per collection, as in the Keystatic collections
// -------------------------------------------------------------------------------------------------------------

const common = [callout, disclosure, embed, figure, footnote, grid, inlineImage, link, linkButton, video];

export const componentSets = {
	"resources-hosted": [
		...common,
		carousel,
		diagram,
		imageComparisonSlider,
		imageLayers,
		language,
		languageBlock,
		quiz,
		splitPoint,
		tabs,
		videoCard,
		worksheet,
	],
	"resources-external": [...common, externalResource, quiz, videoCard],
	"resources-pathfinders": [...common, carousel, imageLayers, language, languageBlock, splitPoint, tabs, worksheet],
	"resources-events": [...common, carousel, imageLayers, language, languageBlock, tabs, worksheet],
	curricula: [...common, carousel, imageLayers, language, languageBlock, quiz, tabs, videoCard, worksheet],
	documentation: [...common, carousel, imageLayers, quiz, splitPoint, tabs, worksheet],
};
