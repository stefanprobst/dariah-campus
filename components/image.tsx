import NextImage, { type ImageProps as NextImageProps } from "next/image";
import type { ReactNode } from "react";

import { CmsImage } from "#/components/cms-image.tsx";
import { mediaImagePrefix } from "#/lib/cms/media.ts";

interface ImageProps extends Omit<NextImageProps, "loader"> {}

export function Image(props: Readonly<ImageProps>): ReactNode {
	const { alt, src, ...rest } = props;

	/** Images of the media library come as a URL, or as an object with their dimensions. */
	if (typeof src === "string" && src.startsWith(mediaImagePrefix)) {
		return <CmsImage {...rest} alt={alt} src={src} />;
	}
	if (typeof src === "object" && "src" in src && src.src.startsWith(mediaImagePrefix)) {
		/** `fill` images take their size from the container. */
		const dimensions = rest.fill === true ? {} : { height: rest.height ?? src.height, width: rest.width ?? src.width };
		return <CmsImage {...rest} {...dimensions} alt={alt} src={src.src} />;
	}

	return <NextImage {...rest} alt={alt} src={src} />;
}
