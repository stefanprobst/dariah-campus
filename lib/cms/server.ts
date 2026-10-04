import "server-only";

import { createAuth, createDevelopmentAuthProvider, createGitHubAuthProvider } from "@stefanprobst/cms/identity";
import { createCmsNext } from "@stefanprobst/cms/next";
import type { Reader } from "@stefanprobst/cms/reader";
import { createCmsServer } from "@stefanprobst/cms/server";

import { env } from "#/configs/env.config.ts";
import { publishedReader } from "#/lib/cms/reader.ts";
import { roles, schema } from "#/lib/cms/schema.ts";
import { content, identity, images, mediaStore, secret } from "#/lib/cms/stores.ts";

/** The CMS in next.js: its API routes, sign-in, and preview of change sets. */

const baseUrl = env.CMS_BASE_URL ?? env.NEXT_PUBLIC_APP_BASE_URL;

/** Fixed accounts for local development. Never enable the development provider on a deployed site. */
const developmentUsers = [
	{ subject: "1", login: "admin", name: "Ada Admin" },
	{ subject: "2", login: "editor", name: "Edith Editor" },
	{ subject: "3", login: "contributor", name: "Carl Contributor" },
];

const providers = [];
if (env.CMS_GITHUB_CLIENT_ID != null && env.CMS_GITHUB_CLIENT_SECRET != null) {
	providers.push(
		createGitHubAuthProvider({ clientId: env.CMS_GITHUB_CLIENT_ID, clientSecret: env.CMS_GITHUB_CLIENT_SECRET }),
	);
}
if (env.NODE_ENV !== "production") {
	providers.push(createDevelopmentAuthProvider({ users: developmentUsers }));
}

const auth = createAuth({ identity, providers, secret, baseUrl });

export const cms = createCmsNext({
	server: createCmsServer({ schema, roles, content, identity, auth, baseUrl, media: { store: mediaStore, images } }),
	auth,
	content,
	baseUrl,
});

/** The reader for the current request: a change set while previewing, published content otherwise. */
export async function getReader(): Promise<Reader<typeof schema>> {
	return publishedReader.withRef(await cms.getPreviewRef());
}
