"use client";

import { useMediaPreviewUrl } from "@stefanprobst/cms/admin";
import type { ImageValue } from "@stefanprobst/cms/schema";
import type { ReactNode } from "react";

/** A position on an image, in percent of its width and height. */
export interface Point {
	x: number;
	y: number;
}

/** The image's own size, so pixels shown to an author are the ones they would measure in an image editor. */
export interface ImageSize {
	height: number;
	width: number;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Positions are kept to one decimal, which is finer than a pixel on any image the cms shows. */
export function round(value: number): number {
	return Math.round(value * 10) / 10;
}

/** The pointer position on the overlay, clamped to the image. */
export function getPoint(overlay: Element, clientX: number, clientY: number): Point {
	const bounds = overlay.getBoundingClientRect();

	return {
		x: round(clamp(((clientX - bounds.left) / bounds.width) * 100, 0, 100)),
		y: round(clamp(((clientY - bounds.top) / bounds.height) * 100, 0, 100)),
	};
}

export function toPixels(value: number, length: number): number {
	return Math.round((value / 100) * length);
}

interface OverlayImageProps {
	onSize: (size: ImageSize | null) => void;
	placeholder: string;
	value: ImageValue | null;
}

/** The image markers are placed on. Markers wait for `onSize`, as positions mean nothing before the image is shown. */
export function OverlayImage(props: Readonly<OverlayImageProps>): ReactNode {
	const { onSize, placeholder, value } = props;
	const src = useMediaPreviewUrl(value, 1200);

	if (src == null) {
		return (
			<div className="grid place-items-center bg-neutral-100 p-3 text-center text-sm text-neutral-500 min-block-32">
				{placeholder}
			</div>
		);
	}

	return (
		// oxlint-disable-next-line @next/next/no-img-element
		<img
			alt={value?.alt ?? ""}
			className="select-none block-auto inline-full"
			draggable={false}
			onError={() => {
				onSize(null);
			}}
			onLoad={(event) => {
				const image = event.currentTarget;
				onSize({ height: image.naturalHeight, width: image.naturalWidth });
			}}
			src={src}
		/>
	);
}
