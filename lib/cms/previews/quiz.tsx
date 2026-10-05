import { isNonEmptyString } from "@acdh-oeaw/lib";
import { NotEditable, definePreview } from "@stefanprobst/cms/admin";
import cn from "clsx/lite";
import {
	FormInputIcon,
	LayoutGridIcon,
	ListOrderedIcon,
	MessageCircleQuestionIcon,
	RectangleHorizontalIcon,
	SquareDashedIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
	quiz,
	quizChoice,
	quizChoiceAnswer,
	quizChoiceAnswerErrorMessage,
	quizChoiceAnswerLabel,
	quizChoiceQuestion,
	quizDragTheWords,
	quizErrorMessage,
	quizFillInTheBlank,
	quizMatching,
	quizMatchingZone,
	quizOrdering,
	quizOrderingItem,
	quizQuestion,
	quizSuccessMessage,
} from "#/lib/cms/components.ts";
import { icon } from "#/lib/cms/previews/text.tsx";

const questionIcon = icon(MessageCircleQuestionIcon);

function Hint(props: Readonly<{ children: ReactNode }>): ReactNode {
	return <NotEditable className="px-3 pbs-2 text-xs text-neutral-500">{props.children}</NotEditable>;
}

function BlankSyntax(props: Readonly<{ alternatives: boolean }>): ReactNode {
	const rows = [
		["@@answer@@", "Single accepted answer"],
		...(props.alternatives ? [["@@answer1//answer2@@", "Multiple accepted answers"]] : []),
		["@@answer::hint@@", "Answer with hint"],
	];

	return (
		<Hint>
			<p>Use this syntax to create blanks (with optional hint):</p>
			<table>
				<tbody>
					{rows.map(([syntax, description]) => (
						<tr key={syntax}>
							<td className="pe-3 font-mono">{syntax}</td>
							<td>{description}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Hint>
	);
}

export const quizPreviews = [
	definePreview(quiz, { icon: questionIcon }),
	definePreview(quizQuestion, { icon: questionIcon }),
	definePreview(quizSuccessMessage, { icon: questionIcon }),
	definePreview(quizErrorMessage, { icon: questionIcon }),
	definePreview(quizChoice, { icon: questionIcon }),
	definePreview(quizChoiceQuestion, { icon: questionIcon }),
	definePreview(quizChoiceAnswerLabel, { icon: questionIcon }),
	definePreview(quizChoiceAnswerErrorMessage, { icon: questionIcon }),

	definePreview(quizChoiceAnswer, {
		icon: questionIcon,
		Preview(props) {
			const isCorrect = props.kind === "correct";

			return (
				<div className={cn("border-s-4", isCorrect ? "border-s-success-600" : "border-s-neutral-300")}>
					<NotEditable
						className={cn("px-3 pbs-2 text-xs font-medium", isCorrect ? "text-success-800" : "text-neutral-500")}
					>
						{isCorrect ? "Correct answer" : "Incorrect answer"}
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizFillInTheBlank, {
		icon: icon(FormInputIcon),
		Preview(props) {
			return (
				<div>
					<BlankSyntax alternatives={true} />
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizDragTheWords, {
		icon: icon(FormInputIcon),
		Preview(props) {
			return (
				<div>
					<BlankSyntax alternatives={false} />
					{props.distractors.length > 0 ? <Hint>Distractors: {props.distractors.join(", ")}</Hint> : null}
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizOrdering, {
		icon: icon(ListOrderedIcon),
		Preview(props) {
			return (
				<div>
					<Hint>The order the items are listed in here is the correct one. Users see them shuffled.</Hint>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizOrderingItem, {
		icon: icon(RectangleHorizontalIcon),
		Preview(props) {
			return (
				<div>
					<NotEditable className="px-3 pbs-2 text-sm font-medium">
						{isNonEmptyString(props.label) ? props.label : "Untitled item"}
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizMatching, {
		icon: icon(LayoutGridIcon),
		Preview(props) {
			return (
				<div>
					<Hint>
						{props.orderedZones
							? "The order the zones are listed in here is the correct one. Users see them shuffled, and put them back in order as well as filling them."
							: "The zones are laid out in a grid, in the order they are listed in here."}
					</Hint>
					{props.distractors.length > 0 ? (
						<Hint>Distractors: {props.distractors.map((item) => item.label).join(", ")}</Hint>
					) : null}
					{props.children}
				</div>
			);
		},
	}),

	definePreview(quizMatchingZone, {
		icon: icon(SquareDashedIcon),
		Preview(props) {
			return (
				<div>
					<NotEditable className="grid gap-y-1 px-3 pbs-2 text-sm">
						<span className="font-medium">{isNonEmptyString(props.label) ? props.label : "Untitled zone"}</span>
						<span className="text-neutral-600">
							{props.items.length > 0
								? props.items.map((item) => item.label).join(", ")
								: "No items belong in this zone."}
						</span>
					</NotEditable>
					{props.children}
				</div>
			);
		},
	}),
];
