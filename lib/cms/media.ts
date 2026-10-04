import { createMediaUrls } from "@stefanprobst/cms/media/urls";

/** What dariah-campus stores in the media library besides images, video, audio and PDF. */
export const mediaContentTypes = [
	"image/*",
	"video/*",
	"audio/*",
	"application/pdf",
	"application/zip",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"text/markdown",
];

/** A few event recordings are larger than the default limit. */
export const maxMediaSize = 200 * 1024 * 1024;

/**
 * Media are served through the CMS API, which redirects to signed imgproxy URLs: the bucket has no public access, and
 * browsers cannot sign. These URLs need no secret, so client components can build them too.
 */
export const mediaUrls = createMediaUrls({ apiPath: "/api/cms" });

/** Prefix of image URLs which can be resized, see `components/cms-image.tsx`. */
export const mediaImagePrefix = "/api/cms/media/image/";

/** Where a file of the media library is served: images resizable, others, including SVG, as they are. */
export function getMediaSource(file: { key: string; contentType: string; filename: string }): string {
	if (file.contentType.startsWith("image/") && file.contentType !== "image/svg+xml") {
		return mediaUrls.image(file.key);
	}
	return mediaUrls.file(file.key, file.contentType.startsWith("image/") ? {} : { filename: file.filename });
}
