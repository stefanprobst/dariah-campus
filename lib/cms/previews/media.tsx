"use client";

import { isNonEmptyString } from "@acdh-oeaw/lib";
import { NotEditable, definePreview, useMediaPreviewUrl } from "@stefanprobst/cms/admin";
import type { ImageValue } from "@stefanprobst/cms/schema";
import cn from "clsx/lite";
import {
	GalleryHorizontalIcon,
	GripVerticalIcon,
	ImageIcon,
	ImagesIcon,
	LayersIcon,
	PlayCircleIcon,
	VideoIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
	carousel,
	carouselItem,
	figure,
	imageComparisonSlider,
	imageLayer,
	imageLayers,
	inlineImage,
	videoCard,
} from "#/lib/cms/components.ts";
import { icon } from "#/lib/cms/previews/text.tsx";
import type { FigureAlignment } from "#/lib/content/options.ts";
import { createVideoUrl } from "#/lib/navigation/create-video-url.ts";

function PreviewImage(
	props: Readonly<{ value: ImageValue | null; width?: number; className?: string; fallback?: ReactNode }>,
): ReactNode {
	const { className, fallback = null, value, width } = props;
	const src = useMediaPreviewUrl(value, width);

	if (src == null) {
		return fallback;
	}

	// oxlint-disable-next-line @next/next/no-img-element
	return <img alt={value?.alt ?? ""} className={className} draggable={false} src={src} />;
}

const noImage = (
	<div className="grid place-items-center rounded-sm bg-neutral-100 py-6 text-sm text-neutral-500">No image</div>
);

const figureAlignments: Record<FigureAlignment, string | undefined> = {
	center: "mx-auto max-inline-1/2",
	"left-one-fourth": "max-inline-1/4",
	"left-one-third": "max-inline-1/3",
	"left-one-half": "max-inline-1/2",
	"left-two-thirds": "max-inline-2/3",
	"right-one-fourth": "ms-auto max-inline-1/4",
	"right-one-third": "ms-auto max-inline-1/3",
	"right-one-half": "ms-auto max-inline-1/2",
	"right-two-thirds": "ms-auto max-inline-2/3",
	stretch: undefined,
};

type Orientation = "horizontal" | "vertical";

/** Compares two images with a draggable separator, as on the website. */
function ComparisonSlider(
	props: Readonly<{ left: ImageValue | null; right: ImageValue | null; orientation: Orientation }>,
): ReactNode {
	const { left, orientation, right } = props;
	/** In percent of the size of the images. */
	const [position, setPosition] = useState(50);
	const [isDragging, setIsDragging] = useState(false);
	const isVertical = orientation === "vertical";

	function move(element: HTMLElement, clientX: number, clientY: number): void {
		const bounds = element.getBoundingClientRect();
		const next = isVertical ? (clientY - bounds.top) / bounds.height : (clientX - bounds.left) / bounds.width;
		setPosition(Math.min(Math.max(next * 100, 0), 100));
	}

	const image = "object-cover select-none [grid-area:1/-1] size-full max-h-[min(60vh,32rem)]";

	return (
		<NotEditable
			className={cn(
				"relative grid touch-none overflow-hidden rounded-sm border border-neutral-200",
				isVertical ? "cursor-row-resize" : "cursor-col-resize",
			)}
			onPointerDown={(event) => {
				setIsDragging(true);
				event.currentTarget.setPointerCapture(event.pointerId);
				move(event.currentTarget, event.clientX, event.clientY);
			}}
			onPointerMove={(event) => {
				if (isDragging) {
					move(event.currentTarget, event.clientX, event.clientY);
				}
			}}
			onPointerUp={(event) => {
				setIsDragging(false);
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
		>
			<PreviewImage className={image} fallback={noImage} value={left} />
			<div
				className="grid [grid-area:1/-1]"
				style={{ clipPath: isVertical ? `inset(${String(position)}% 0 0 0)` : `inset(0 0 0 ${String(position)}%)` }}
			>
				<PreviewImage className={image} value={right} />
			</div>
			<div
				aria-label="Separator between the images"
				aria-orientation={orientation}
				aria-valuemax={100}
				aria-valuemin={0}
				aria-valuenow={Math.round(position)}
				className={cn(
					"absolute grid place-items-center",
					isVertical ? "inset-x-0 -translate-y-1/2 block-0" : "inset-y-0 -translate-x-1/2 inline-0",
				)}
				onKeyDown={(event) => {
					const step = { ArrowUp: -5, ArrowLeft: -5, ArrowDown: 5, ArrowRight: 5 }[event.key];
					if (step != null) {
						event.preventDefault();
						setPosition((current) => Math.min(Math.max(current + step, 0), 100));
					}
				}}
				role="separator"
				style={isVertical ? { top: `${String(position)}%` } : { left: `${String(position)}%` }}
				tabIndex={0}
			>
				<div
					className={cn(
						"bg-white shadow-sm [grid-area:1/-1]",
						isVertical ? "block-1 inline-full" : "block-full inline-1",
					)}
				/>
				<GripVerticalIcon
					aria-hidden={true}
					className={cn("rounded-sm bg-white shadow-sm [grid-area:1/-1] block-6 inline-3", isVertical && "rotate-90")}
				/>
			</div>
		</NotEditable>
	);
}

export const mediaPreviews = [
	definePreview(inlineImage, {
		icon: icon(ImageIcon),
		Preview(props) {
			return (
				<PreviewImage
					className="inline-block align-middle max-block-16 max-inline-40"
					fallback="Image"
					value={props.image}
					width={320}
				/>
			);
		},
	}),

	definePreview(figure, {
		icon: icon(ImageIcon),
		Preview(props) {
			return (
				<figure className={cn("grid gap-y-1", figureAlignments[props.alignment])}>
					<NotEditable className="px-3 pbs-2">
						<PreviewImage
							className="overflow-hidden rounded-lg border border-neutral-200 bg-white inline-full"
							fallback={noImage}
							value={props.image}
						/>
					</NotEditable>
					<figcaption className="text-sm">{props.children}</figcaption>
				</figure>
			);
		},
	}),

	definePreview(carousel, { icon: icon(GalleryHorizontalIcon) }),

	definePreview(carouselItem, {
		icon: icon(ImageIcon),
		Preview(props) {
			return (
				<figure className="grid gap-y-1">
					<NotEditable className="px-3 pbs-2">
						<PreviewImage
							className="mx-auto rounded-sm border border-neutral-200 bg-white object-contain max-block-64 max-inline-full"
							fallback={noImage}
							value={props.image}
						/>
					</NotEditable>
					<figcaption className="text-sm">{props.children}</figcaption>
				</figure>
			);
		},
	}),

	definePreview(imageComparisonSlider, {
		icon: icon(ImagesIcon),
		Preview(props) {
			return (
				<figure className="grid gap-y-1">
					<div className="px-3 pbs-2">
						<ComparisonSlider left={props.left} orientation={props.orientation} right={props.right} />
					</div>
					<figcaption className="text-sm">{props.children}</figcaption>
				</figure>
			);
		},
	}),

	definePreview(imageLayers, {
		icon: icon(LayersIcon),
		Preview(props) {
			return <div className="[counter-reset:image-layer]">{props.children}</div>;
		},
	}),

	definePreview(imageLayer, {
		icon: icon(ImageIcon),
		Preview(props) {
			return (
				<figure className="grid gap-y-2 px-3 py-2 text-sm [counter-increment:image-layer]">
					<PreviewImage
						className="mx-auto rounded-sm border border-neutral-200 bg-white object-contain max-block-64 max-inline-full"
						fallback={noImage}
						value={props.image}
					/>
					{isNonEmptyString(props.label) ? (
						<figcaption>{props.label}</figcaption>
					) : (
						/** The layer name is optional, and falls back to the layer position. */
						<figcaption className="text-neutral-500 after:[content:counter(image-layer)]">Layer&nbsp;</figcaption>
					)}
				</figure>
			);
		},
	}),

	definePreview(videoCard, {
		icon: icon(VideoIcon),
		Preview(props) {
			const href = isNonEmptyString(props.id)
				? String(createVideoUrl(props.provider, props.id, props.startTime))
				: null;

			return (
				<figure className="m-3 grid gap-y-4 rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-md">
					{href != null ? (
						<iframe
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowFullScreen={true}
							className="aspect-video overflow-hidden rounded-lg border border-neutral-200 inline-full"
							loading="lazy"
							src={href}
							title={props.title}
						/>
					) : null}
					<figcaption className="grid justify-items-center gap-y-1">
						<PreviewImage className="rounded-sm max-block-32" value={props.image} width={400} />
						<PlayCircleIcon aria-hidden={true} className="shrink-0 text-brand-700 block-12 inline-12" />
						<strong className="text-xl font-bold">{props.title}</strong>
						<div className="text-sm text-neutral-500">{props.subtitle}</div>
					</figcaption>
				</figure>
			);
		},
	}),
];
