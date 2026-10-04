import "server-nodejs-only";

import { groupByToMap, keyByToMap, unique } from "@acdh-oeaw/lib";
import type { Ref } from "@stefanprobst/cms/core";
import type { Reader } from "@stefanprobst/cms/reader";
import type { RichTextRoot } from "@stefanprobst/cms/rich-text";
import type { AnyField, InferEntryData } from "@stefanprobst/cms/schema";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";

import { getMediaSource } from "#/lib/cms/media.ts";
import type * as schemaModule from "#/lib/cms/schema.ts";
import { schema } from "#/lib/cms/schema.ts";
import { type PreparedContent, prepareContent } from "#/lib/cms/site/prepare.ts";
import { type ContentProps, createContent } from "#/lib/cms/site/renderers.tsx";
import { client as contentLanguages } from "#/lib/content/client/content/languages.ts";
import { client as contentLicenses } from "#/lib/content/client/content/licenses.ts";
import { client as contentTypes } from "#/lib/content/client/content/types.ts";
import type { CollectionClient, SingletonClient } from "#/lib/content/types.ts";
import { type LinkSchema, getLinkProps } from "#/lib/content/utils/get-link-props.ts";
import { defaultLocale, getIntlLanguage } from "#/lib/i18n/locales.ts";
import type { NavigationLink, NavigationSeparator } from "#/lib/navigation/navigation";
import messages from "#/messages/en.json";

/**
 * The content client of the site, backed by the CMS reader. It returns entries in the shape the pages used with the mdx
 * pipeline: Keystatic field names, slugs instead of entry IDs, images with their dimensions, and rich text as
 * renderable components. Pages can move to the CMS data model one at a time later.
 */

// -------------------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------------------

export type ContentComponent = (props: ContentProps) => ReactNode;

export interface LegacyImage {
	src: string;
	width: number;
	height: number;
}

type KebabCase<S extends string> = S extends `${infer Head}${infer Tail}`
	? `${Head extends Lowercase<Head> ? Head : `-${Lowercase<Head>}`}${KebabCase<Tail>}`
	: S;

type LegacyKey<K extends string> = K extends "language" ? "locale" : KebabCase<K>;

/** Optional text fields, which Keystatic read as empty strings rather than `null`. */
type TextKey = "doi" | "subtitle" | "title" | "version";

type LinkKinds = "download" | "email" | "entry" | "external" | "hash" | "search";

/** The value shapes of the mdx pipeline, derived from the schema. */
export type Legacy<T> = T extends string | number | boolean | null | undefined
	? T
	: T extends RichTextRoot
		? ContentComponent
		: T extends { kind: LinkKinds; value?: never }
			? LinkSchema
			: T extends { media: string; alt: string | null }
				? LegacyImage
				: T extends { media: string }
					? string
					: T extends { kind: infer K; value: infer V }
						? { discriminant: K; value: Legacy<V> }
						: T extends ReadonlyArray<infer I>
							? Array<Legacy<I>>
							: T extends object
								? { [K in keyof T as LegacyKey<K & string>]: K extends TextKey ? string : Legacy<T[K]> }
								: T;

type Data<TName extends string> = InferEntryData<
	Extract<(typeof schemaModule)[keyof typeof schemaModule], { name: TName; type: "collection" | "singleton" }>
>;

type Metadata<TName extends string> = Omit<Legacy<Data<TName>>, "content">;

interface Translations {
	translations: Array<string>;
	"is-translation-of"?: string;
}

// -------------------------------------------------------------------------------------------------------------
// Conversion
// -------------------------------------------------------------------------------------------------------------

const t = createTranslator({ locale: defaultLocale, messages, namespace: "mdx" });

interface Context {
	slugs: Map<string, Map<string, string>>;
	media: Map<string, { src: string; width: number | null; height: number | null }>;
}

function getSlug(context: Context, collection: string, id: string): string | null {
	return context.slugs.get(collection)?.get(id) ?? null;
}

function toLegacyLink(value: unknown, context: Context): LinkSchema | null {
	if (value == null) {
		return null;
	}
	const link = value as Record<string, string | null>;
	switch (link.kind!) {
		case "external": {
			return { discriminant: "external", value: link.url! };
		}
		case "email": {
			return { discriminant: "email", value: link.email! };
		}
		case "hash": {
			return { discriminant: "hash", value: link.hash! };
		}
		case "download": {
			return { discriminant: "download", value: context.media.get(link.media!)?.src ?? "" };
		}
		case "search": {
			return { discriminant: "search", value: { search: link.search ?? "", hash: link.hash ?? "" } };
		}
		default: {
			const slug = getSlug(context, link.collection!, link.id!);
			if (slug == null) {
				return null;
			}
			return {
				discriminant: link.collection,
				value: { id: slug, hash: link.hash ?? "" },
			} as LinkSchema;
		}
	}
}

function once<T>(fn: () => T): () => T {
	let result: { value: T } | undefined;
	return () => {
		result ??= { value: fn() };
		return result.value;
	};
}

/** Copies properties including getters, so lazily prepared content stays lazy. Object spread would call the getters. */
function extend<A extends object, B extends object>(target: A, extra: B): Omit<A, keyof B> & B {
	return Object.defineProperties(
		{},
		{ ...Object.getOwnPropertyDescriptors(target), ...Object.getOwnPropertyDescriptors(extra) },
	) as Omit<A, keyof B> & B;
}

/** Content which is prepared on first use: preparing every entry up front takes seconds. */
function lazyContent(value: RichTextRoot, context: Context) {
	const prepared = once(() => prepare(value, context));
	return Object.defineProperties(
		{ content: createContent(() => prepared().tree) },
		{
			sections: { enumerable: true, get: () => prepared().sections },
			tableOfContents: { enumerable: true, get: () => prepared().tableOfContents },
		},
	) as { content: ContentComponent } & Pick<PreparedContent, "sections" | "tableOfContents">;
}

function prepare(value: RichTextRoot, context: Context): PreparedContent {
	return prepareContent(value, {
		language: getIntlLanguage(defaultLocale),
		labels: {
			footnotes: t("footnotes"),
			footnoteBackLabel: (reference) => t("footnote-back-label", { reference }),
		},
		resolveImage: (media) => context.media.get(media) ?? null,
		resolveLink: (link) => toLegacyLink(link, context),
	});
}

function toKebabCase(key: string): string {
	return key === "language" ? "locale" : key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toLegacy(field: AnyField, value: unknown, context: Context): unknown {
	const definition = field as AnyField & Record<string, unknown>;
	if (value == null) {
		/** Keystatic read empty text as an empty string. */
		return field.kind === "text" || field.kind === "handle" ? "" : value;
	}
	switch (field.kind) {
		case "relationship": {
			const collection = definition.collection as string;
			if (Array.isArray(value)) {
				return value.map((id: string) => getSlug(context, collection, id)).filter((slug) => slug != null);
			}
			return getSlug(context, collection, value as string);
		}
		case "image": {
			const image = context.media.get((value as { media: string }).media);
			return image != null ? { src: image.src, width: image.width, height: image.height } : null;
		}
		case "file": {
			return context.media.get((value as { media: string }).media)?.src ?? null;
		}
		case "link": {
			return toLegacyLink(value, context);
		}
		case "rich-text": {
			return lazyContent(value as RichTextRoot, context).content;
		}
		case "object": {
			const fields = definition.fields as Record<string, AnyField>;
			const object = value as Record<string, unknown>;
			return Object.fromEntries(
				Object.entries(fields).map(([key, child]) => [toKebabCase(key), toLegacy(child, object[key], context)]),
			);
		}
		case "array": {
			return (value as Array<unknown>).map((item) => toLegacy(definition.item as AnyField, item, context));
		}
		case "union": {
			const union = value as { kind: string; value: unknown };
			const option = (definition.options as Record<string, AnyField>)[union.kind]!;
			return { discriminant: union.kind, value: toLegacy(option, union.value, context) };
		}
		default: {
			return value;
		}
	}
}

function toMetadata<TName extends string>(name: TName, data: unknown, context: Context): Metadata<TName> {
	const collection = schema.get(name)!;
	const { content: _content, ...metadata } = toLegacy(collection.data, data, context) as Record<string, unknown>;
	return metadata as Metadata<TName>;
}

function richText(data: unknown): RichTextRoot {
	return (data as { content: RichTextRoot }).content;
}

function hasText(value: RichTextRoot): boolean {
	return value.children.length > 0;
}

/** Tag descriptions as plain text, for contexts which cannot render rich text, e.g. a search facet listbox. */
function toPlainText(value: RichTextRoot): string {
	function text(node: unknown): string {
		const current = node as { type: string; value?: string; children?: Array<unknown> };
		if (current.type === "text") {
			return current.value ?? "";
		}
		return (current.children ?? []).map(text).join("");
	}
	return value.children.map(text).join("\n\n");
}

// -------------------------------------------------------------------------------------------------------------
// Client
// -------------------------------------------------------------------------------------------------------------

function createCollectionClient<T extends { id: string }>(items: Array<T>): CollectionClient<T> {
	const byId = keyByToMap(items, (item) => item.id);
	return {
		ids: () => Promise.resolve(items.map((item) => item.id)),
		all: () => Promise.resolve(items),
		byId: () => Promise.resolve(byId),
		get: (id) => Promise.resolve(byId.get(id) ?? null),
	};
}

function createSingletonClient<T>(item: T): SingletonClient<T> {
	return { get: () => Promise.resolve(item) };
}

function byPublicationDate(
	a: { metadata: { "publication-date": string } },
	z: { metadata: { "publication-date": string } },
) {
	return z.metadata["publication-date"].localeCompare(a.metadata["publication-date"]);
}

async function createSiteClient(reader: Reader<typeof schema>) {
	const list = async <TName extends (typeof schema.collections)[number]["name"]>(name: TName) =>
		reader.collection(name).list();

	const [
		hostedEntries,
		externalEntries,
		pathfinderEntries,
		eventEntries,
		curriculumEntries,
		documentationEntries,
		peopleEntries,
		tagEntries,
		sourceEntries,
		consortiumEntries,
		workingGroupEntries,
		mediaEntries,
	] = await Promise.all([
		list("resources-hosted"),
		list("resources-external"),
		list("resources-pathfinders"),
		list("resources-events"),
		list("curricula"),
		list("documentation"),
		list("people"),
		list("tags"),
		list("sources"),
		list("dariah-national-consortia"),
		list("dariah-working-groups"),
		list("media"),
	]);

	const context: Context = {
		slugs: new Map(
			(
				[
					hostedEntries,
					externalEntries,
					pathfinderEntries,
					eventEntries,
					curriculumEntries,
					documentationEntries,
					peopleEntries,
					tagEntries,
					sourceEntries,
					consortiumEntries,
					workingGroupEntries,
				] as Array<Array<{ collection: string; id: string; slug: string }>>
			).map((entries) => [entries[0]?.collection ?? "", new Map(entries.map((entry) => [entry.id, entry.slug]))]),
		),
		media: new Map(
			mediaEntries.map((entry) => [
				entry.id,
				{
					src: getMediaSource(entry.data.file!),
					width: entry.data.file!.width,
					height: entry.data.file!.height,
				},
			]),
		),
	};

	function document<TName extends string>(name: TName, entry: { id: string; slug: string; data: unknown }) {
		return extend(lazyContent(richText(entry.data), context), {
			id: entry.slug,
			/** The id in the cms, e.g. for links to the admin. */
			entryId: entry.id,
			metadata: toMetadata(name, entry.data, context),
		});
	}

	/**
	 * Translations are linked entries now, and drafts are change sets, which are never published: pages which still check
	 * for these find none.
	 */
	const translations: Translations & { draft?: boolean } = { translations: [] };

	const hosted = hostedEntries.map((entry) => {
		const doc = document("resources-hosted", entry);
		return extend(doc, { metadata: { ...doc.metadata, ...translations } });
	});
	const external = externalEntries.map((entry) => {
		const doc = document("resources-external", entry);
		return extend(doc, { metadata: { ...doc.metadata, ...translations } });
	});
	const pathfinders = pathfinderEntries.map((entry) => {
		const doc = document("resources-pathfinders", entry);
		return extend(doc, { metadata: { ...doc.metadata, ...translations, "content-type": "pathfinder" as const } });
	});
	const events = eventEntries.map((entry) => {
		const doc = document("resources-events", entry);
		return extend(doc, { metadata: { ...doc.metadata, ...translations, "content-type": "event" as const } });
	});
	const curricula = curriculumEntries.map((entry) => {
		const doc = document("curricula", entry);
		const { "supplementary-information": supplementary, ...metadata } = doc.metadata;
		return extend(doc, {
			metadata: {
				...metadata,
				...translations,
				"content-type": "curriculum" as const,
				"supplementary-information": { content: supplementary },
				/** Resources which are not published, e.g. still drafts, are left out. */
				resources: metadata.resources.filter((resource) => (resource.value as string | null) != null),
			},
		});
	});

	/** Derived indexes, as in `lib/content/client`. */
	type AnyResource =
		| (typeof hosted)[number]
		| (typeof external)[number]
		| (typeof pathfinders)[number]
		| (typeof events)[number];
	const resourceList: Array<AnyResource> = [...events, ...external, ...hosted, ...pathfinders];
	const resourcesByTagId = groupByToMap(resourceList, (resource) => resource.metadata.tags);
	const curriculaByResourceId = groupByToMap(curricula, (curriculum) =>
		curriculum.metadata.resources.map((resource) => resource.value),
	);

	function getRelated(resource: AnyResource): Set<string> {
		const related = new Set<string>();
		for (const tag of resource.metadata.tags) {
			for (const other of resourcesByTagId.get(tag) ?? []) {
				if (other.id !== resource.id) {
					related.add(other.id);
				}
			}
		}
		return related;
	}

	function withResourceFields<T extends AnyResource, K extends string>(resource: T, kind: K, path: string) {
		return extend(resource, {
			href: `/resources/${path}/${resource.id}`,
			kind,
			curricula: curriculaByResourceId.get(resource.id)?.map((curriculum) => curriculum.id) ?? [],
			related: getRelated(resource),
		});
	}

	const resourcesHosted = hosted
		.map((resource) => withResourceFields(resource, "hosted", "hosted"))
		.toSorted(byPublicationDate);
	const resourcesExternal = external
		.map((resource) => withResourceFields(resource, "external", "external"))
		.toSorted(byPublicationDate);
	const resourcesPathfinders = pathfinders
		.map((resource) => withResourceFields(resource, "pathfinder", "pathfinders"))
		.toSorted(byPublicationDate);
	const resourcesEvents = events
		.map((resource) => withResourceFields(resource, "event", "events"))
		.toSorted(byPublicationDate);
	const resources = [...resourcesEvents, ...resourcesExternal, ...resourcesHosted, ...resourcesPathfinders].toSorted(
		byPublicationDate,
	);

	const curriculaByTagId = groupByToMap(curricula, (curriculum) => curriculum.metadata.tags);
	const curriculaClient = curricula
		.map((curriculum) => {
			const related = new Set<string>();
			for (const tag of curriculum.metadata.tags) {
				for (const other of curriculaByTagId.get(tag) ?? []) {
					if (other.id !== curriculum.id) {
						related.add(other.id);
					}
				}
			}
			return extend(curriculum, { href: `/curricula/${curriculum.id}`, related });
		})
		.toSorted(byPublicationDate);

	function getPersonIds(metadata: { authors?: Array<string>; editors?: Array<string>; contributors?: Array<string> }) {
		const { authors = [], contributors = [], editors = [] } = metadata;
		return unique([...authors, ...editors, ...contributors]);
	}
	const resourcesByPersonId = groupByToMap(resourceList, (resource) => getPersonIds(resource.metadata));
	const curriculaByPersonId = groupByToMap(curricula, (curriculum) => getPersonIds(curriculum.metadata));
	const people = peopleEntries
		.map((entry) => {
			const content = richText(entry.data);
			return {
				id: entry.slug,
				metadata: toMetadata("people", entry.data, context),
				content: lazyContent(content, context).content,
				hasContent: hasText(content),
				href: `/people/${entry.slug}`,
				curricula: curriculaByPersonId.get(entry.slug)?.map((curriculum) => curriculum.id) ?? [],
				resources: resourcesByPersonId.get(entry.slug)?.map((resource) => resource.id) ?? [],
			};
		})
		.toSorted((a, z) => a.metadata.name.localeCompare(z.metadata.name));

	const tags = tagEntries
		.map((entry) => {
			const content = richText(entry.data);
			return {
				id: entry.slug,
				metadata: { ...toMetadata("tags", entry.data, context), description: toPlainText(content) },
				content: lazyContent(content, context).content,
				href: `/topics/${entry.slug}`,
				curricula: curriculaByTagId.get(entry.slug)?.map((curriculum) => curriculum.id) ?? [],
				resources: resourcesByTagId.get(entry.slug)?.map((resource) => resource.id) ?? [],
			};
		})
		.toSorted((a, z) => a.metadata.name.localeCompare(z.metadata.name));

	const resourcesBySourceId = groupByToMap(resourceList, (resource) => resource.metadata.sources);
	const curriculaBySourceId = groupByToMap(curricula, (curriculum) => curriculum.metadata.sources);
	const sources = sourceEntries
		.map((entry) => {
			return {
				id: entry.slug,
				metadata: toMetadata("sources", entry.data, context),
				content: lazyContent(richText(entry.data), context).content,
				href: `/sources/${entry.slug}`,
				curricula: curriculaBySourceId.get(entry.slug)?.map((curriculum) => curriculum.id) ?? [],
				resources: resourcesBySourceId.get(entry.slug)?.map((resource) => resource.id) ?? [],
			};
		})
		.toSorted((a, z) => a.metadata.name.localeCompare(z.metadata.name));

	const navigationEntry = await reader.singleton("navigation").get();
	const navigationData = toLegacy(
		schema.get("navigation")!.data,
		navigationEntry?.data,
		context,
	) as Metadata<"navigation">;
	const documentationOrder = navigationData.documentation.links;
	const documentation = documentationEntries
		.map((entry) => extend(document("documentation", entry), { href: `/documentation/${entry.slug}` }))
		.toSorted((a, z) => documentationOrder.indexOf(a.id) - documentationOrder.indexOf(z.id));

	const navigation = Object.fromEntries(
		navigationData.links.map((item, index) => {
			const value =
				item.discriminant === "link"
					? ({
							type: "link",
							href: getLinkProps(item.value.link).href,
							label: item.value.label,
						} satisfies NavigationLink)
					: ({ type: "separator" } satisfies NavigationSeparator);
			return [`item-${String(index)}`, value];
		}),
	);

	const indexPageEntry = await reader.singleton("index-page").get();
	const indexPageData = toLegacy(
		schema.get("index-page")!.data,
		indexPageEntry?.data,
		context,
	) as Metadata<"index-page">;
	/** Keystatic called the image of a video `src`. */
	const toVideo = (video: (typeof indexPageData)["about-section"]["videos"][number]) => {
		const { image, ...rest } = video;
		return { ...rest, src: image };
	};
	const indexPage = {
		...indexPageData,
		"about-section": { ...indexPageData["about-section"], videos: indexPageData["about-section"].videos.map(toVideo) },
		"testimonial-section": {
			...indexPageData["testimonial-section"],
			videos: indexPageData["testimonial-section"].videos.map(toVideo),
		},
	};

	const legalNoticeEntry = await reader.singleton("legal-notice").get();
	const legalNotice = {
		id: "",
		content: lazyContent(legalNoticeEntry?.data.content ?? { type: "root", children: [] }, context).content,
	};

	return {
		collections: {
			contentLanguages,
			contentLicenses,
			contentTypes,
			curricula: createCollectionClient(curriculaClient),
			documentation: createCollectionClient(documentation),
			people: createCollectionClient(people),
			resources: createCollectionClient(resources),
			resourcesEvents: createCollectionClient(resourcesEvents),
			resourcesExternal: createCollectionClient(resourcesExternal),
			resourcesHosted: createCollectionClient(resourcesHosted),
			resourcesPathfinders: createCollectionClient(resourcesPathfinders),
			sources: createCollectionClient(sources),
			tags: createCollectionClient(tags),
		},
		singletons: {
			indexPage: createSingletonClient(indexPage),
			legalNotice: createSingletonClient(legalNotice),
			navigation: createSingletonClient(navigation),
		},
	};
}

export type SiteClient = Awaited<ReturnType<typeof createSiteClient>>;
export type IndexPage = Awaited<ReturnType<SiteClient["singletons"]["indexPage"]["get"]>>;
export type HostedResource = Awaited<ReturnType<SiteClient["collections"]["resourcesHosted"]["all"]>>[number];

// -------------------------------------------------------------------------------------------------------------
// Caching
// -------------------------------------------------------------------------------------------------------------

/** One client per ref, rebuilt when the content changes. */
const clients = new Map<string, { revision: string; client: Promise<SiteClient> }>();

function getRefKey(ref: Ref): string {
	return ref.kind === "published" ? "published" : `change-set:${ref.id}`;
}

export async function getSiteClient(reader: Reader<typeof schema>): Promise<SiteClient> {
	const key = getRefKey(reader.ref);
	const revision = await reader.getRevision();
	const cached = clients.get(key);
	if (cached?.revision === revision) {
		return cached.client;
	}
	const client = createSiteClient(reader);
	clients.set(key, { revision, client });
	client.catch(() => {
		clients.delete(key);
	});
	return client;
}
