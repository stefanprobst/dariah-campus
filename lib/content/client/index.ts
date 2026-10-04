import "server-nodejs-only";

import { cache } from "react";

import { publishedReader } from "#/lib/cms/reader.ts";
import { type SiteClient, getSiteClient } from "#/lib/cms/site/client.ts";

/**
 * Published content, read through the CMS. Methods are asynchronous anyway, so the client is created on first use.
 *
 * @see lib/cms/site/client.ts
 */

/** Checking for content changes reads the content directory, so it happens once per request. */
const getPublishedClient = cache(async () => getSiteClient(publishedReader));

type Collections = SiteClient["collections"];
type Singletons = SiteClient["singletons"];

function collection<TName extends keyof Collections>(name: TName): Collections[TName] {
	const get = async () => (await getPublishedClient()).collections[name];
	return {
		ids: async () => (await get()).ids(),
		all: async () => (await get()).all(),
		byId: async () => (await get()).byId(),
		get: async (id: string) => (await get()).get(id as never),
	} as Collections[TName];
}

function singleton<TName extends keyof Singletons>(name: TName): Singletons[TName] {
	return {
		get: async () => (await getPublishedClient()).singletons[name].get(),
	} as Singletons[TName];
}

export const client = {
	collections: {
		contentLanguages: collection("contentLanguages"),
		contentLicenses: collection("contentLicenses"),
		contentTypes: collection("contentTypes"),
		curricula: collection("curricula"),
		documentation: collection("documentation"),
		people: collection("people"),
		resources: collection("resources"),
		resourcesEvents: collection("resourcesEvents"),
		resourcesExternal: collection("resourcesExternal"),
		resourcesHosted: collection("resourcesHosted"),
		resourcesPathfinders: collection("resourcesPathfinders"),
		sources: collection("sources"),
		tags: collection("tags"),
	},
	singletons: {
		indexPage: singleton("indexPage"),
		legalNotice: singleton("legalNotice"),
		navigation: singleton("navigation"),
	},
} satisfies SiteClient;
