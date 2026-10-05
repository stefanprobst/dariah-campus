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
import { GrabIcon, SquareDashedIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { quizImageDropZone, quizImageDropZones } from "#/lib/cms/components.ts";
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

type DropZone = PreviewChild<InferProps<typeof quizImageDropZone>>;

interface Box {
	height: number;
	width: number;
	x: number;
	y: number;
}

/** The schema allows no smaller, and a zone below this is impossible to grab again once it has been drawn. */
const minSize = 1;

function getLabel(zone: DropZone): string {
	return isNonEmptyString(zone.props.label) ? zone.props.label : "Untitled drop zone";
}

function getBox(zone: DropZone): Box | null {
	const { height, width, x, y } = zone.props;
	return height != null && width != null && x != null && y != null ? { height, width, x, y } : null;
}

function moveBox(origin: Box, point: Point, grab: Point): Box {
	return {
		height: origin.height,
		width: origin.width,
		x: round(clamp(point.x - grab.x, 0, 100 - origin.width)),
		y: round(clamp(point.y - grab.y, 0, 100 - origin.height)),
	};
}

interface Edges {
	blockEnd?: boolean;
	blockStart?: boolean;
	inlineEnd?: boolean;
	inlineStart?: boolean;
}

/** The edges the handle does not control stay where they are, so the opposite side of the zone acts as the anchor. */
function resizeBox(origin: Box, edges: Edges, point: Point): Box {
	let { height, width, x, y } = origin;

	if (edges.inlineStart === true) {
		const inlineEnd = x + width;
		x = clamp(point.x, 0, inlineEnd - minSize);
		width = inlineEnd - x;
	} else if (edges.inlineEnd === true) {
		width = clamp(point.x - x, minSize, 100 - x);
	}

	if (edges.blockStart === true) {
		const blockEnd = y + height;
		y = clamp(point.y, 0, blockEnd - minSize);
		height = blockEnd - y;
	} else if (edges.blockEnd === true) {
		height = clamp(point.y - y, minSize, 100 - y);
	}

	return { height: round(height), width: round(width), x: round(x), y: round(y) };
}

/** Both corners are already clamped to the image, so the rectangle they span cannot leave it either. */
function drawBox(start: Point, point: Point): Box {
	const x = Math.min(start.x, point.x);
	const y = Math.min(start.y, point.y);

	return {
		height: round(clamp(Math.abs(point.y - start.y), minSize, 100 - y)),
		width: round(clamp(Math.abs(point.x - start.x), minSize, 100 - x)),
		x: round(x),
		y: round(y),
	};
}

/**
 * Width and height are percentages of different axes, so equal numbers only describe a square on a square image. The
 * side is settled in pixels and converted back, which keeps a square square and a circle round on any image. `anchor`
 * names the edges the gesture is pulling away from, which therefore stay where they are.
 */
function toSquare(box: Box, anchor: Edges, bounds: DOMRect): Box {
	const inlineEnd = box.x + box.width;
	const blockEnd = box.y + box.height;

	/** The longer side wins, so the shape follows the gesture instead of collapsing onto its shorter axis. */
	let side = Math.max((box.width / 100) * bounds.width, (box.height / 100) * bounds.height);

	/** A square which would reach past the image is shrunk to fit rather than dragged off its anchor. */
	const availableInline = anchor.inlineEnd === true ? inlineEnd : 100 - box.x;
	const availableBlock = anchor.blockEnd === true ? blockEnd : 100 - box.y;
	side = Math.min(side, (availableInline / 100) * bounds.width, (availableBlock / 100) * bounds.height);
	side = Math.max(side, (minSize / 100) * Math.max(bounds.width, bounds.height));

	const width = (side / bounds.width) * 100;
	const height = (side / bounds.height) * 100;

	return {
		height: round(height),
		width: round(width),
		x: round(anchor.inlineEnd === true ? inlineEnd - width : box.x),
		y: round(anchor.blockEnd === true ? blockEnd - height : box.y),
	};
}

const handles: Array<{ cursor: string; edges: Edges; label: string; x: number; y: number }> = [
	{ cursor: "cursor-nwse-resize", edges: { blockStart: true, inlineStart: true }, label: "top left", x: 0, y: 0 },
	{ cursor: "cursor-ns-resize", edges: { blockStart: true }, label: "top", x: 50, y: 0 },
	{ cursor: "cursor-nesw-resize", edges: { blockStart: true, inlineEnd: true }, label: "top right", x: 100, y: 0 },
	{ cursor: "cursor-ew-resize", edges: { inlineStart: true }, label: "left", x: 0, y: 50 },
	{ cursor: "cursor-ew-resize", edges: { inlineEnd: true }, label: "right", x: 100, y: 50 },
	{ cursor: "cursor-nesw-resize", edges: { blockEnd: true, inlineStart: true }, label: "bottom left", x: 0, y: 100 },
	{ cursor: "cursor-ns-resize", edges: { blockEnd: true }, label: "bottom", x: 50, y: 100 },
	{ cursor: "cursor-nwse-resize", edges: { blockEnd: true, inlineEnd: true }, label: "bottom right", x: 100, y: 100 },
];

interface Gesture {
	box: Box;
	edges: Edges;
	grab: Point;
	hasMoved: boolean;
	kind: "draw" | "move" | "resize";
	origin: Box;
	overlay: Element;
	pointerId: number;
	start: Point;
}

/**
 * Pointer gestures on the image, which change a zone's box. The box is held while a gesture is in flight, so the
 * document is written once on release instead of on every move.
 */
function useGesture(onChange: (box: Box) => void) {
	const [draft, setDraft] = useState<Box | null>(null);
	const gestureRef = useRef<Gesture | null>(null);

	function start(
		event: ReactPointerEvent<HTMLElement>,
		overlay: Element | null,
		kind: Gesture["kind"],
		origin: Box,
		edges: Edges = {},
	): void {
		if (event.button !== 0 || overlay == null) {
			return;
		}
		const point = getPoint(overlay, event.clientX, event.clientY);
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		gestureRef.current = {
			box: origin,
			edges,
			grab: { x: point.x - origin.x, y: point.y - origin.y },
			hasMoved: false,
			kind,
			origin,
			overlay,
			pointerId: event.pointerId,
			start: point,
		};
	}

	function move(event: ReactPointerEvent<HTMLElement>): void {
		const gesture = gestureRef.current;
		if (gesture?.pointerId !== event.pointerId) {
			return;
		}
		const point = getPoint(gesture.overlay, event.clientX, event.clientY);
		if (point.x !== gesture.start.x || point.y !== gesture.start.y) {
			gesture.hasMoved = true;
		}

		let next =
			gesture.kind === "resize"
				? resizeBox(gesture.origin, gesture.edges, point)
				: gesture.kind === "move"
					? moveBox(gesture.origin, point, gesture.grab)
					: drawBox(gesture.start, point);

		/**
		 * Ctrl or cmd squares the zone off, which is what turns a rectangle into a square and an ellipse into a circle.
		 * Read off the event, so the shape follows the key being held or let go part way through the drag.
		 */
		if ((event.ctrlKey || event.metaKey) && gesture.kind !== "move") {
			const anchor =
				gesture.kind === "draw"
					? { blockEnd: point.y < gesture.start.y, inlineEnd: point.x < gesture.start.x }
					: { blockEnd: gesture.edges.blockStart === true, inlineEnd: gesture.edges.inlineStart === true };
			next = toSquare(next, anchor, gesture.overlay.getBoundingClientRect());
		}

		gesture.box = next;
		setDraft(next);
	}

	function end(event: ReactPointerEvent<HTMLElement>): void {
		const gesture = gestureRef.current;
		if (gesture?.pointerId !== event.pointerId) {
			return;
		}
		event.currentTarget.releasePointerCapture(event.pointerId);
		gestureRef.current = null;
		setDraft(null);
		/** A click which never moved selects the zone, and must not resize it to nothing. */
		if (gesture.hasMoved) {
			onChange(gesture.box);
		}
	}

	return { draft, end, move, start };
}

function boxStyle(box: Box): CSSProperties {
	return {
		blockSize: `${String(box.height)}%`,
		inlineSize: `${String(box.width)}%`,
		insetBlockStart: `${String(box.y)}%`,
		insetInlineStart: `${String(box.x)}%`,
	};
}

/** A percentage radius inscribes an ellipse in the box; a length would round it into a stadium instead. */
function shapeClassName(zone: DropZone): string {
	return zone.props.shape === "ellipse" ? "rounded-[50%]" : "rounded-md";
}

interface ZoneShapeProps {
	box: Box;
	isReadOnly: boolean;
	zone: DropZone;
}

/** Dragged to move, pulled by its handles to resize, and moved or resized (with alt) by the arrow keys. */
function ZoneShape(props: Readonly<ZoneShapeProps>): ReactNode {
	const { isReadOnly, zone } = props;
	const gesture = useGesture((box) => {
		zone.setProps({ ...zone.props, ...box });
	});
	const box = gesture.draft ?? props.box;
	const label = getLabel(zone);

	return (
		<div className={cn("absolute", zone.isSelected ? "z-10" : undefined)} data-drop-zone="" style={boxStyle(box)}>
			<button
				aria-label={`Move drop zone: ${label}. Arrow keys move it, alt and arrow keys resize it.`}
				className={cn(
					"absolute inset-0 flex cursor-move touch-none border-2 border-dashed border-brand-700 transition-colors outline-none",
					shapeClassName(zone),
					zone.props.shape === "ellipse" ? "items-center justify-center" : "items-start justify-start",
					zone.isSelected ? "border-solid bg-brand-50/80" : "bg-white/75",
				)}
				onClick={() => {
					zone.select();
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
					/** Without a mouse the same keys do both jobs, so alt asks for the far edges instead. */
					zone.setProps({
						...zone.props,
						...(event.altKey
							? {
									height: round(clamp(box.height + movement[1]!, minSize, 100 - box.y)),
									width: round(clamp(box.width + movement[0]!, minSize, 100 - box.x)),
								}
							: {
									x: round(clamp(box.x + movement[0]!, 0, 100 - box.width)),
									y: round(clamp(box.y + movement[1]!, 0, 100 - box.height)),
								}),
					});
				}}
				onPointerDown={(event) => {
					if (!isReadOnly) {
						gesture.start(event, event.currentTarget.closest("[data-drop-zone-overlay]"), "move", box);
					}
				}}
				onPointerMove={gesture.move}
				onPointerUp={gesture.end}
				type="button"
			>
				<span className="truncate p-1 text-xs font-medium text-brand-900">{label}</span>
			</button>

			{/* Pointer shortcuts for what alt and the arrow keys already do, so they stay out of the tab order. */}
			{zone.isSelected && !isReadOnly
				? handles.map((handle) => (
						<span
							key={handle.label}
							aria-hidden={true}
							className={cn(
								"absolute -translate-1/2 touch-none rounded-xs border border-white bg-brand-700 block-2.5 inline-2.5",
								handle.cursor,
							)}
							onPointerDown={(event) => {
								gesture.start(
									event,
									event.currentTarget.closest("[data-drop-zone-overlay]"),
									"resize",
									box,
									handle.edges,
								);
							}}
							onPointerMove={gesture.move}
							onPointerUp={gesture.end}
							style={{ insetBlockStart: `${String(handle.y)}%`, insetInlineStart: `${String(handle.x)}%` }}
						/>
					))
				: null}
		</div>
	);
}

interface DrawSurfaceProps {
	onDone: () => void;
	zone: DropZone;
}

/** Covers the image while a zone is drawn in one gesture. */
function DrawSurface(props: Readonly<DrawSurfaceProps>): ReactNode {
	const { onDone, zone } = props;
	const gesture = useGesture((box) => {
		zone.setProps({ ...zone.props, ...box });
		onDone();
	});

	return (
		<div
			className="absolute inset-0 z-20 grid cursor-crosshair touch-none place-items-center bg-brand-900/10"
			data-draw-surface=""
			onPointerDown={(event) => {
				gesture.start(event, event.currentTarget, "draw", { height: 0, width: 0, x: 0, y: 0 });
			}}
			onPointerMove={gesture.move}
			onPointerUp={gesture.end}
		>
			{gesture.draft != null ? (
				<div
					className={cn("absolute border-2 border-brand-700 bg-brand-50/80", shapeClassName(zone))}
					style={boxStyle(gesture.draft)}
				/>
			) : (
				<span className="rounded-md bg-brand-900/80 px-2 py-1 text-xs font-medium text-white">
					Drag to draw {getLabel(zone)}, holding ctrl or cmd for a{" "}
					{zone.props.shape === "ellipse" ? "circle" : "square"}
				</span>
			)}
		</div>
	);
}

function describe(box: Box, size: ImageSize | null): string {
	const percent = `${String(box.x)}%, ${String(box.y)}%, ${String(box.width)} × ${String(box.height)}%`;
	if (size == null) {
		return percent;
	}
	const pixels = `${String(toPixels(box.x, size.width))}, ${String(toPixels(box.y, size.height))}, ${String(toPixels(box.width, size.width))} × ${String(toPixels(box.height, size.height))} px`;
	return `${percent} ≈ ${pixels}`;
}

function DropZonesPreview(
	props: Readonly<{ children: ReactNode; image: InferProps<typeof quizImageDropZones>["image"] }>,
): ReactNode {
	const { children, image } = props;
	const zones = useComponentChildren(quizImageDropZone);
	const isReadOnly = useIsReadOnly();
	const [size, setSize] = useState<ImageSize | null>(null);
	/** The zone to redraw; a zone without a position is drawn as soon as it is selected. */
	const [redraw, setRedraw] = useState<number | null>(null);
	const selected = zones.find((zone) => zone.isSelected);
	const selectedBox = selected != null ? getBox(selected) : null;
	const drawing =
		!isReadOnly && size != null && selected != null && (selectedBox == null || redraw === selected.index)
			? selected
			: null;

	return (
		<figure className="grid">
			<NotEditable className="grid gap-y-1 px-3 pbs-2 text-sm">
				<div
					aria-label="Drop zones"
					className="relative isolate overflow-hidden rounded-md"
					data-drop-zone-overlay=""
					role="group"
				>
					<OverlayImage
						onSize={setSize}
						placeholder="Add a background image to place the drop zones on."
						value={image}
					/>
					{size != null
						? zones.map((zone) => {
								const box = getBox(zone);
								return box != null && zone !== drawing ? (
									<ZoneShape key={zone.index} box={box} isReadOnly={isReadOnly} zone={zone} />
								) : null;
							})
						: null}
					{drawing != null ? (
						<DrawSurface
							key={drawing.index}
							onDone={() => {
								setRedraw(null);
							}}
							zone={drawing}
						/>
					) : null}
				</div>
				<div className="flex items-center justify-between gap-x-3 text-neutral-600 min-block-8">
					{selected != null ? (
						<p>
							<strong className="font-medium text-neutral-800">{getLabel(selected)}</strong>{" "}
							{selectedBox != null ? `at ${describe(selectedBox, size)}` : "is not placed yet"}
						</p>
					) : (
						<p>Select a drop zone to move or resize it, or to draw it on the image.</p>
					)}
					{selected != null && selectedBox != null && !isReadOnly && size != null ? (
						<button
							className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-50"
							onClick={() => {
								setRedraw(redraw === selected.index ? null : selected.index);
							}}
							type="button"
						>
							{redraw === selected.index ? "Cancel" : "Redraw"}
						</button>
					) : null}
				</div>
			</NotEditable>
			{children}
		</figure>
	);
}

export const imageDropZonesPreviews = [
	definePreview(quizImageDropZones, {
		icon: icon(GrabIcon),
		Preview: DropZonesPreview,
	}),

	definePreview(quizImageDropZone, {
		icon: icon(SquareDashedIcon),
		Preview(props) {
			const isPlaced = props.x != null && props.y != null && props.width != null && props.height != null;

			return (
				<div>
					<NotEditable className="grid gap-y-1 px-3 pbs-2 text-sm">
						<p>
							<span className="font-medium">{isNonEmptyString(props.label) ? props.label : "Untitled drop zone"}</span>{" "}
							<span className="text-neutral-500">
								{isPlaced
									? `${props.shape} at ${String(props.x)}%, ${String(props.y)}%, ${String(props.width)} × ${String(props.height)}%`
									: "not placed yet"}
							</span>
						</p>
						<p className="text-neutral-600">
							{props.items.length > 0
								? props.items.map((item) => item.label).join(", ")
								: "No items belong in this zone."}
						</p>
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),
];
