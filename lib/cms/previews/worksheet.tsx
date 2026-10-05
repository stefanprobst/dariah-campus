import { isNonEmptyString } from "@acdh-oeaw/lib";
import { NotEditable, definePreview } from "@stefanprobst/cms/admin";
import cn from "clsx/lite";
import { FileTextIcon, ListIcon, PencilLineIcon, TextIcon } from "lucide-react";

import {
	worksheet,
	worksheetDescription,
	worksheetQuestion,
	worksheetSection,
	worksheetSectionDescription,
} from "#/lib/cms/components.ts";
import { icon } from "#/lib/cms/previews/text.tsx";

export const worksheetPreviews = [
	definePreview(worksheet, {
		icon: icon(FileTextIcon),
		Preview(props) {
			return (
				<div className="grid [counter-reset:worksheet-section]">
					<NotEditable className="px-3 pbs-2 text-sm font-bold">{props.title}</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(worksheetDescription, {
		icon: icon(TextIcon),
		Preview(props) {
			return <div className="text-sm text-neutral-600">{props.children}</div>;
		},
	}),

	definePreview(worksheetSection, {
		icon: icon(ListIcon),
		Preview(props) {
			return (
				<div className="grid [counter-increment:worksheet-section]">
					<NotEditable className="px-3 pbs-2 text-xs text-neutral-500 uppercase before:[content:'Step_'counter(worksheet-section)'_·_']">
						{props.title}
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(worksheetSectionDescription, {
		icon: icon(TextIcon),
		Preview(props) {
			return <div className="text-sm text-neutral-600">{props.children}</div>;
		},
	}),

	definePreview(worksheetQuestion, {
		icon: icon(PencilLineIcon),
		Preview(props) {
			return (
				<div className="grid gap-y-1 px-3 py-2 text-sm">
					<strong>{props.label}</strong>
					{isNonEmptyString(props.description) ? <span className="text-neutral-600">{props.description}</span> : null}
					<div
						className={cn(
							"rounded-sm border border-dashed border-neutral-300 bg-white px-2 py-1 text-neutral-500",
							props.variant === "long" && "block-16",
						)}
					>
						{isNonEmptyString(props.placeholder) ? props.placeholder : "…"}
					</div>
				</div>
			);
		},
	}),
];
