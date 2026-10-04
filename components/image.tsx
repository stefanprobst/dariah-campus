import NextImage, { type ImageProps as NextImageProps } from "next/image";
import type { ReactNode } from "react";

import { CmsImage } from "#/components/cms-image.tsx";
import { mediaImagePrefix } from "#/lib/cms/media.ts";

interface ImageProps extends Omit<NextImageProps, "loader"> {}

export function Image(props: Readonly<ImageProps>): ReactNode {
	const { alt, src, ...rest } = props;

	if (typeof src === "string" && src.startsWith(mediaImagePrefix)) {
		return <CmsImage {...rest} alt={alt} src={src} />;
	}

	return <NextImage {...rest} alt={alt} src={src} />;
}
