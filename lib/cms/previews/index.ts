import type { ComponentPreview } from "@stefanprobst/cms/admin";

import { mediaPreviews } from "#/lib/cms/previews/media.tsx";
import { quizPreviews } from "#/lib/cms/previews/quiz.tsx";
import { textPreviews } from "#/lib/cms/previews/text.tsx";
import { worksheetPreviews } from "#/lib/cms/previews/worksheet.tsx";

/**
 * How content components look in the cms editor, ported from the Keystatic previews. Styled with the website's design
 * tokens, see `app/(cms)/admin/previews.css`.
 */
export const previews: ReadonlyArray<ComponentPreview> = [
	...textPreviews,
	...mediaPreviews,
	...worksheetPreviews,
	...quizPreviews,
];
