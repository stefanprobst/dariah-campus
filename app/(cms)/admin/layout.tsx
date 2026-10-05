import "#/app/(cms)/admin/admin.css";
import "#/styles/cms-previews.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocalizedStringProvider } from "react-aria-components/i18n";

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
			<body>
				{/* The client bundle leaves out react-aria's strings, see `next.config.ts`. */}
				<LocalizedStringProvider locale={locale} />
				{props.children}
			</body>
		</html>
	);
}
