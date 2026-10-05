import type { ComponentPreview } from "@stefanprobst/cms/admin";

import { imageDropZonesPreviews } from "#/lib/cms/previews/image-drop-zones.tsx";
import { imageHotspotsPreviews } from "#/lib/cms/previews/image-hotspots.tsx";
import { mediaPreviews } from "#/lib/cms/previews/media.tsx";
import { quizPreviews } from "#/lib/cms/previews/quiz.tsx";
import { textPreviews } from "#/lib/cms/previews/text.tsx";
import { worksheetPreviews } from "#/lib/cms/previews/worksheet.tsx";

/**
 * How content components look in the cms editor, ported from the Keystatic previews. Styled with the website's design
 * tokens, see `styles/cms-previews.css`.
 */
export const previews: ReadonlyArray<ComponentPreview> = [
	...textPreviews,
	...mediaPreviews,
	...worksheetPreviews,
	...quizPreviews,
	...imageHotspotsPreviews,
	...imageDropZonesPreviews,
];
