"use client";

import NextImage, { type ImageLoader, type ImageProps } from "next/image";
import type { ReactNode } from "react";

/**
 * Images of the media library, in the sizes `next/image` asks for: the CMS API redirects to signed imgproxy URLs, see
 * `lib/cms/media.ts`. The loader is a function, so this has to be a client component.
 */
const loader: ImageLoader = ({ quality, src, width }) =>
	`${src}?width=${String(width)}&quality=${String(quality ?? 75)}`;

export function CmsImage(props: Readonly<Omit<ImageProps, "loader">>): ReactNode {
	return <NextImage {...props} loader={loader} />;
}
