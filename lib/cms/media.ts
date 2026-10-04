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
