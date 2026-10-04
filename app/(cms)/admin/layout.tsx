import "#/app/(cms)/admin/admin.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getMetadata } from "#/lib/i18n/metadata.ts";

const locale = "en";

export async function generateMetadata(): Promise<Metadata> {
	const meta = await getMetadata();

	return {
		title: ["CMS", meta.title].join(" | "),
		robots: { index: false },
	};
}

interface CmsLayoutProps {
	children: ReactNode;
}

export default function CmsLayout(props: Readonly<CmsLayoutProps>): ReactNode {
	return (
		<html lang={locale}>
			<body>{props.children}</body>
		</html>
	);
}
