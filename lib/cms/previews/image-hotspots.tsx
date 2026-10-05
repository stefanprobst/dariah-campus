"use client";

import { isNonEmptyString } from "@acdh-oeaw/lib";
import {
	NotEditable,
	type PreviewChild,
	definePreview,
	useComponentChildren,
	useIsReadOnly,
} from "@stefanprobst/cms/admin";
import type { InferProps } from "@stefanprobst/cms/schema";
import cn from "clsx/lite";
import { MapPinIcon, MessageCircleQuestionIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { quizImageHotspot, quizImageHotspots } from "#/lib/cms/components.ts";
import {
	type ImageSize,
	OverlayImage,
	type Point,
	clamp,
	getPoint,
	round,
	toPixels,
} from "#/lib/cms/previews/image-overlay.tsx";
import { icon } from "#/lib/cms/previews/text.tsx";

type Hotspot = PreviewChild<InferProps<typeof quizImageHotspot>>;

function getLabel(hotspot: Hotspot): string {
	return isNonEmptyString(hotspot.props.label) ? hotspot.props.label : "Untitled hotspot";
}

interface PinProps {
	hotspot: Hotspot;
	isReadOnly: boolean;
}

/** Dragged to move, or moved with the arrow keys; a click selects the hotspot. */
function Pin(props: Readonly<PinProps>): ReactNode {
	const { hotspot, isReadOnly } = props;
	/** Held while dragging, so the document is written once on release instead of on every move. */
	const [draft, setDraft] = useState<Point | null>(null);
	const dragRef = useRef<{ pointerId: number; startX: number; startY: number; hasMoved: boolean } | null>(null);
	const position = draft ?? { x: hotspot.props.x, y: hotspot.props.y };

	return (
		<button
			aria-label={`Move hotspot: ${getLabel(hotspot)}`}
			className={cn(
				"absolute grid -translate-1/2 touch-none place-items-center rounded-full border-2 border-white text-white shadow-md transition-[scale] outline-none block-9 inline-9 hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
				hotspot.isSelected ? "z-10 scale-125 bg-brand-900 ring-4 ring-brand-300" : "bg-brand-700",
			)}
			data-hotspot=""
			onClick={() => {
				hotspot.select();
			}}
			onKeyDown={(event) => {
				const step = event.shiftKey ? 5 : 1;
				const movement = { ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step] }[
					event.key
				];
				if (movement == null || isReadOnly) {
					return;
				}
				event.preventDefault();
				hotspot.setProps({
					...hotspot.props,
					x: round(clamp(hotspot.props.x + movement[0]!, 0, 100)),
					y: round(clamp(hotspot.props.y + movement[1]!, 0, 100)),
				});
			}}
			onPointerDown={(event) => {
				if (event.button !== 0 || isReadOnly) {
					return;
				}
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, hasMoved: false };
			}}
			onPointerMove={(event) => {
				const drag = dragRef.current;
				const overlay = event.currentTarget.parentElement;
				if (drag?.pointerId !== event.pointerId || overlay == null) {
					return;
				}
				/** A small wobble is still a click. */
				if (!drag.hasMoved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
					return;
				}
				drag.hasMoved = true;
				setDraft(getPoint(overlay, event.clientX, event.clientY));
			}}
			onPointerUp={(event) => {
				const drag = dragRef.current;
				const overlay = event.currentTarget.parentElement;
				if (drag?.pointerId !== event.pointerId) {
					return;
				}
				event.currentTarget.releasePointerCapture(event.pointerId);
				dragRef.current = null;
				setDraft(null);
				if (drag.hasMoved && overlay != null) {
					hotspot.setProps({ ...hotspot.props, ...getPoint(overlay, event.clientX, event.clientY) });
				}
			}}
			style={{ insetBlockStart: `${String(position.y)}%`, insetInlineStart: `${String(position.x)}%` }}
			type="button"
		>
			<MapPinIcon aria-hidden={true} className="block-5 inline-5" />
		</button>
	);
}

function HotspotsPreview(
	props: Readonly<{ children: ReactNode; image: InferProps<typeof quizImageHotspots>["image"] }>,
) {
	const { children, image } = props;
	const hotspots = useComponentChildren(quizImageHotspot);
	const isReadOnly = useIsReadOnly();
	const [size, setSize] = useState<ImageSize | null>(null);
	const selected = hotspots.find((hotspot) => hotspot.isSelected);

	return (
		<figure className="grid">
			<NotEditable className="grid gap-y-1 px-3 pbs-2 text-sm">
				<div aria-label="Hotspots" className="relative isolate overflow-hidden rounded-md" role="group">
					<OverlayImage onSize={setSize} placeholder="Choose an image to place hotspots." value={image} />
					{size != null
						? hotspots.map((hotspot) => <Pin key={hotspot.index} hotspot={hotspot} isReadOnly={isReadOnly} />)
						: null}
				</div>
				<p className="text-neutral-600">
					{selected != null ? (
						<>
							<strong className="font-medium text-neutral-800">{getLabel(selected)}</strong> at {selected.props.x}%,{" "}
							{selected.props.y}%
							{size != null ? (
								<>
									{" "}
									&asymp; {toPixels(selected.props.x, size.width)}, {toPixels(selected.props.y, size.height)}
									&nbsp;px
								</>
							) : null}
						</>
					) : (
						"Drag a hotspot to move it, or select it and use the arrow keys (with shift for larger steps)."
					)}
				</p>
			</NotEditable>
			{children}
		</figure>
	);
}

export const imageHotspotsPreviews = [
	definePreview(quizImageHotspots, {
		icon: icon(MessageCircleQuestionIcon),
		Preview: HotspotsPreview,
	}),

	definePreview(quizImageHotspot, {
		icon: icon(MapPinIcon),
		Preview(props) {
			return (
				<div>
					<NotEditable className="px-3 pbs-2 text-sm">
						<span className="font-medium">{isNonEmptyString(props.label) ? props.label : "Untitled hotspot"}</span>{" "}
						<span className="text-neutral-500">
							at {props.x}%, {props.y}%
						</span>
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),
];
