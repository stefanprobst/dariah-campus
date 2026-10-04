import "server-nodejs-only";

import * as path from "node:path";

import { createFsContentStore, createFsIdentityStore, createFsMediaStore } from "@stefanprobst/cms/adapters/fs";
import {
	createGitHubApi,
	createGitHubAppAuth,
	createGitHubContentStore,
	createGitIdentityStore,
} from "@stefanprobst/cms/adapters/github";
import { createS3MediaStore } from "@stefanprobst/cms/adapters/s3";
import { type ContentStore, type MediaStore, createJsonEntryFormat } from "@stefanprobst/cms/core";
import type { IdentityStore } from "@stefanprobst/cms/identity";
import { type ImageUrlBuilder, createDirectImageUrlBuilder, createImgproxyUrlBuilder } from "@stefanprobst/cms/media";

import { env } from "#/configs/env.config.ts";
import { maxMediaSize, mediaContentTypes } from "#/lib/cms/media.ts";
import { schema } from "#/lib/cms/schema.ts";

/**
 * The stores, chosen by environment variables:
 *
 * - Content: the GitHub repository `CMS_CONTENT_REPO`, through a GitHub App (`CMS_GITHUB_APP_*`), else the filesystem
 *   (`CMS_ROOT`, defaulting to the output of `pnpm cms:migrate`).
 * - Users: a JSON file in a private GitHub repository when `CMS_CONFIG_REPO` is set, else `cms-config/users.json`.
 * - Media: an S3-compatible bucket when `CMS_S3_ENDPOINT` is set, else the filesystem; images through imgproxy when
 *   `CMS_IMGPROXY_URL` is set.
 */

function required<TName extends keyof typeof env>(name: TName): NonNullable<(typeof env)[TName]> {
	const value = env[name];
	if (value == null) {
		throw new Error(`Missing environment variable "${name}".`);
	}
	return value;
}

const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.CMS_ROOT);

/** Signs sessions and upload URLs. Only the local default works without one. */
export const secret = env.CMS_SECRET ?? "dariah-campus-secret-only-for-local-development";

const format = createJsonEntryFormat({ schema });

function createGitHubHost(repository: string) {
	const [owner, repo] = repository.split("/");
	if (owner == null || repo == null) {
		throw new Error(`Expected a repository as "owner/name", received "${repository}".`);
	}
	const token = createGitHubAppAuth({
		appId: required("CMS_GITHUB_APP_ID"),
		privateKey: required("CMS_GITHUB_APP_PRIVATE_KEY").replaceAll(String.raw`\n`, "\n"),
		installationId: required("CMS_GITHUB_APP_INSTALLATION_ID"),
	});
	return createGitHubApi({ owner, repo, token });
}

function createContentStore(): ContentStore {
	if (env.CMS_CONTENT_REPO != null) {
		return createGitHubContentStore({
			host: createGitHubHost(env.CMS_CONTENT_REPO),
			format,
			baseBranch: env.CMS_CONTENT_BRANCH,
		});
	}
	/** In production, content on the filesystem only changes through the store, which keeps its cache current. */
	return createFsContentStore({ root, format, cache: env.NODE_ENV === "production" ? "static" : "check" });
}

function createIdentityStore(): IdentityStore {
	if (env.CMS_CONFIG_REPO != null) {
		return createGitIdentityStore({ host: createGitHubHost(env.CMS_CONFIG_REPO) });
	}
	return createFsIdentityStore({
		file: path.resolve(/* turbopackIgnore: true */ process.cwd(), "cms-config/users.json"),
	});
}

function createMediaStore(): MediaStore {
	const rules = { contentTypes: mediaContentTypes, maxSize: maxMediaSize };
	if (env.CMS_S3_ENDPOINT != null) {
		return createS3MediaStore({
			endpoint: env.CMS_S3_ENDPOINT,
			bucket: required("CMS_S3_BUCKET"),
			accessKeyId: required("CMS_S3_ACCESS_KEY_ID"),
			secretAccessKey: required("CMS_S3_SECRET_ACCESS_KEY"),
			...(env.CMS_S3_PUBLIC_URL != null ? { publicUrl: env.CMS_S3_PUBLIC_URL } : {}),
			...rules,
		});
	}
	return createFsMediaStore({ directory: path.join(root, "media-files"), secret, ...rules });
}

function createImageUrlBuilder(store: MediaStore): ImageUrlBuilder {
	if (env.CMS_IMGPROXY_URL != null) {
		const bucket = required("CMS_S3_BUCKET");
		return createImgproxyUrlBuilder({
			baseUrl: env.CMS_IMGPROXY_URL,
			key: required("CMS_IMGPROXY_KEY"),
			salt: required("CMS_IMGPROXY_SALT"),
			source: (key) => `s3://${bucket}/${key}`,
		});
	}
	return createDirectImageUrlBuilder(store);
}

export const content = createContentStore();
export const identity = createIdentityStore();
export const mediaStore = createMediaStore();
export const images = createImageUrlBuilder(mediaStore);
