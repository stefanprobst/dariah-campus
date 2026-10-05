import { capitalize, isNonEmptyString } from "@acdh-oeaw/lib";
import { styles } from "@acdh-oeaw/style-variants";
import { NotEditable, definePreview } from "@stefanprobst/cms/admin";
import {
	AlertTriangleIcon,
	AppWindowIcon,
	BoltIcon,
	BookIcon,
	CaptionsIcon,
	ChartBarStackedIcon,
	ChevronDownIcon,
	ChevronDownSquareIcon,
	GridIcon,
	InfoIcon,
	LightbulbIcon,
	LinkIcon,
	type LucideIcon,
	PencilIcon,
	PilcrowLeftIcon,
	SeparatorHorizontalIcon,
	SquareIcon,
	TextIcon,
	VideoIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
	callout,
	diagram,
	diagramCaption,
	diagramCodeBlock,
	disclosure,
	embed,
	externalResource,
	grid,
	gridItem,
	languageBlock,
	linkButton,
	splitPoint,
	tab,
	tabs,
	video,
} from "#/lib/cms/components.ts";
import { type CalloutKind, getTextDirection } from "#/lib/content/options.ts";
import { createVideoUrl } from "#/lib/navigation/create-video-url.ts";

/** Icons in the frame of a component, which sit next to its label. */
export function icon(Icon: LucideIcon): ReactNode {
	return <Icon aria-hidden={true} className="shrink-0 block-3.5 inline-3.5" />;
}

const calloutIcons: Record<Exclude<CalloutKind, "none">, LucideIcon> = {
	caution: BoltIcon,
	important: InfoIcon,
	note: PencilIcon,
	tip: LightbulbIcon,
	warning: AlertTriangleIcon,
};

const calloutStyles = styles({
	base: "grid gap-y-1 rounded-md border px-3 py-2 **:text-inherit [&_*::marker]:text-inherit",
	variants: {
		kind: {
			caution: "border-l-4 border-error-200 border-l-error-600 bg-error-50 text-error-800",
			important: "border-l-4 border-important-200 border-l-important-600 bg-important-50 text-important-800",
			note: "border-l-4 border-neutral-200 border-l-neutral-600 bg-neutral-100 text-neutral-800",
			tip: "border-l-4 border-success-200 border-l-success-600 bg-success-50 text-success-800",
			warning: "border-l-4 border-warning-200 border-l-warning-500 bg-warning-50 text-warning-800",
			none: "border-neutral-200 bg-neutral-100 text-neutral-800",
		},
	},
	defaults: {
		kind: "note",
	},
});

function CalloutHeader(props: Readonly<{ kind: CalloutKind; title: string | null }>): ReactNode {
	const { kind, title } = props;

	if (kind !== "none") {
		const Icon = calloutIcons[kind];
		return (
			<strong className="flex items-center gap-x-2 px-3 pbs-1 font-bold">
				<Icon aria-hidden={true} className="shrink-0 block-5 inline-5" />
				<span>{isNonEmptyString(title) ? title : capitalize(kind)}</span>
			</strong>
		);
	}

	return isNonEmptyString(title) ? <strong className="px-3 pbs-1 font-bold">{title}</strong> : null;
}

/** The grid items are children of the editable content element, which is the direct child of the preview. */
const gridStyles = styles({
	base: "*:grid! *:content-start *:gap-4",
	variants: {
		alignment: {
			center: "*:items-center",
			stretch: "",
		},
		layout: {
			"two-columns": "sm:*:grid-cols-2",
			"three-columns": "sm:*:grid-cols-3",
			"four-columns": "sm:*:grid-cols-4",
			"one-two-columns": "sm:*:grid-cols-[1fr_2fr]",
			"one-three-columns": "sm:*:grid-cols-[1fr_3fr]",
			"one-four-columns": "sm:*:grid-cols-[1fr_4fr]",
		},
	},
	defaults: {
		alignment: "stretch",
		layout: "two-columns",
	},
});

const iframeAllow =
	"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

export const textPreviews = [
	definePreview(callout, {
		icon: icon(InfoIcon),
		Preview(props) {
			return (
				<aside className={calloutStyles({ kind: props.kind })}>
					<NotEditable>
						<CalloutHeader kind={props.kind} title={props.title} />
					</NotEditable>
					<div className="[&_a]:underline">{props.children}</div>
				</aside>
			);
		},
	}),

	definePreview(disclosure, {
		icon: icon(ChevronDownSquareIcon),
		Preview(props) {
			return (
				<div className="border-y border-neutral-200">
					<NotEditable className="flex items-center justify-between gap-x-4 px-3 py-2 font-bold">
						<span>{props.title || "(Disclosure title)"}</span>
						<ChevronDownIcon aria-hidden={true} className="shrink-0 rotate-180 text-neutral-500 block-5 inline-5" />
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(languageBlock, {
		icon: icon(PilcrowLeftIcon),
		Preview(props) {
			return (
				<div className="text-start" dir={getTextDirection(props.lang)} lang={props.lang}>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(splitPoint, {
		icon: icon(SeparatorHorizontalIcon),
		Preview(props) {
			return (
				<div className="flex items-center gap-x-3 px-3 py-2 text-neutral-500">
					<hr className="flex-1 border-bs-2 border-dashed border-neutral-300" />
					<span className="shrink-0 text-xs tracking-wide uppercase">
						{isNonEmptyString(props.id) ? `Section: ${props.id}` : "Section"}
					</span>
					<hr className="flex-1 border-bs-2 border-dashed border-neutral-300" />
				</div>
			);
		},
	}),

	definePreview(tabs, { icon: icon(CaptionsIcon) }),

	definePreview(tab, {
		icon: icon(CaptionsIcon),
		Preview(props) {
			return (
				<div className="grid">
					<NotEditable className="px-3 pbs-2 text-sm font-bold">
						{isNonEmptyString(props.title) ? props.title : "(No title)"}
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(grid, {
		icon: icon(GridIcon),
		Preview(props) {
			return <div className={gridStyles({ alignment: props.alignment, layout: props.layout })}>{props.children}</div>;
		},
	}),

	definePreview(gridItem, {
		icon: icon(SquareIcon),
		Preview(props) {
			return <div className={props.alignment === "center" ? "self-center" : undefined}>{props.children}</div>;
		},
	}),

	definePreview(linkButton, {
		icon: icon(LinkIcon),
		Preview(props) {
			return (
				<div className="px-3 py-2">
					<div className="inline-flex rounded-full bg-brand-700 text-sm font-medium text-white">{props.children}</div>
				</div>
			);
		},
	}),

	definePreview(externalResource, {
		icon: icon(BookIcon),
		Preview(props) {
			return (
				<aside className="grid place-items-center gap-y-2 px-3 py-4 text-center text-neutral-800">
					<strong className="text-2xl font-bold">{props.title}</strong>
					<div className="text-neutral-500">{props.subtitle}</div>
					<div className="mbs-2 inline-flex rounded-full bg-brand-700 px-4 py-2 font-medium text-white">
						Go to this resource
					</div>
				</aside>
			);
		},
	}),

	definePreview(embed, {
		icon: icon(AppWindowIcon),
		Preview(props) {
			return (
				<figure className="grid gap-y-2">
					<NotEditable className="px-3 pbs-2">
						{isNonEmptyString(props.src) ? (
							<iframe
								allow={iframeAllow}
								allowFullScreen={true}
								className="aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-white inline-full"
								loading="lazy"
								sandbox=""
								src={props.src}
								title="Embedded content"
							/>
						) : null}
					</NotEditable>
					<figcaption className="text-sm">{props.children}</figcaption>
				</figure>
			);
		},
	}),

	definePreview(video, {
		icon: icon(VideoIcon),
		Preview(props) {
			const href = isNonEmptyString(props.id)
				? String(createVideoUrl(props.provider, props.id, props.startTime))
				: null;

			return (
				<figure className="grid gap-y-2">
					<NotEditable className="px-3 pbs-2">
						{href != null ? (
							<iframe
								allow={iframeAllow}
								allowFullScreen={true}
								className="aspect-video overflow-hidden rounded-lg border border-neutral-200 inline-full"
								loading="lazy"
								src={href}
								title="Video"
							/>
						) : null}
					</NotEditable>
					<figcaption className="text-sm">{props.children}</figcaption>
				</figure>
			);
		},
	}),

	definePreview(diagram, { icon: icon(ChartBarStackedIcon) }),

	definePreview(diagramCodeBlock, {
		icon: icon(ChartBarStackedIcon),
		Preview(props) {
			return (
				<div className="grid">
					<NotEditable className="px-3 pbs-2 text-sm text-neutral-600 italic">
						<p>
							Insert a code block with <code>mermaid</code> as language. See the{" "}
							<a
								className="underline"
								href="https://mermaid.js.org/config/accessibility.html"
								rel="noreferrer"
								target="_blank"
							>
								Mermaid documentation
							</a>{" "}
							to learn how to describe the diagram for assistive technology.
						</p>
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(diagramCaption, {
		icon: icon(TextIcon),
		Preview(props) {
			return <div className="text-sm">{props.children}</div>;
		},
	}),
];
