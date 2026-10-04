import { createMediaCollection } from "@stefanprobst/cms/media";
import { defineRoles } from "@stefanprobst/cms/roles";
import { collection, defineSchema, fields, singleton } from "@stefanprobst/cms/schema";
import * as v from "valibot";

import { componentSets, linkField } from "#/lib/cms/components.ts";
import { contentLanguages, contentLicenses, contentTypes, socialMediaKinds } from "#/lib/content/options.ts";

/**
 * The content schema, ported from the Keystatic collections in `lib/content/keystatic`. Field keys are camelCase
 * (`publication-date` → `publicationDate`), and the content language is `language` (formerly `locale`).
 */

// -------------------------------------------------------------------------------------------------------------
// Shared fields
// -------------------------------------------------------------------------------------------------------------

/** Handle PIDs are assigned by a script, never edited. */
export const handle = fields.defineFieldKind({
	kind: "handle",
	schema: v.nullable(v.pipe(v.string(), v.url())),
	defaultValue: () => null,
	readonly: true,
});

const email = /.+?@.+?/;

function createSocialField() {
	const url = fields.url({ label: "URL", required: true });
	const options = Object.fromEntries(
		socialMediaKinds.map(({ value }) => [
			value,
			value === "email" ? fields.text({ label: "Email", required: true, pattern: email }) : url,
		]),
	) as Record<(typeof socialMediaKinds)[number]["value"], typeof url>;
	return fields.array(fields.union({ label: "Kind", options }), {
		label: "Social media",
		itemLabel: (item) => item.kind,
	});
}

function createSummaryField() {
	return fields.object(
		{
			title: fields.text({ label: "Summary title" }),
			content: fields.text({ label: "Summary", required: true, multiline: true }),
		},
		{ label: "Summary" },
	);
}

function featuredImage() {
	return fields.image({ label: "Featured image", alt: "optional" });
}

function resourceMetadata() {
	return {
		language: fields.select({ label: "Language", options: contentLanguages, defaultValue: "en" }),
		publicationDate: fields.date({ label: "Publication date", required: true, defaultValue: "today" }),
		version: fields.text({ label: "Version", defaultValue: "1.0.0" }),
	};
}

function consortiaAndWorkingGroups() {
	return {
		dariahNationalConsortia: fields.relationship({
			label: "DARIAH national consortia",
			description: "DARIAH member countries contributing to resource (where applicable)",
			collection: "dariah-national-consortia",
			multiple: true,
		}),
		dariahWorkingGroups: fields.relationship({
			label: "DARIAH working groups",
			description: "DARIAH working groups contributing to resource (where applicable)",
			collection: "dariah-working-groups",
			multiple: true,
		}),
		doi: handle({ label: "PID", description: "Automatically assigned Handle PID." }),
	};
}

const people = (label: string, min?: number) =>
	fields.relationship({ label, collection: "people", multiple: true, ...(min != null ? { min } : {}) });

const description = (label = "Description") =>
	fields.richText({
		label,
		blocks: { heading: false, blockquote: false, code: false, table: false },
		components: [],
	});

const content = (components: (typeof componentSets)[keyof typeof componentSets], label = "Content") =>
	/** Keystatic offered levels 2–5, but content uses 6 as well. */
	fields.richText({ label, blocks: { heading: { levels: [2, 3, 4, 5, 6] } }, components });

const attachments = () =>
	fields.array(
		fields.object(
			{
				label: fields.text({ label: "Label", required: true }),
				file: fields.file({ label: "Attachment", required: true }),
			},
			{ label: "Attachment" },
		),
		{ label: "Attachments", itemLabel: (item) => item.label },
	);

const links = () =>
	fields.array(
		fields.object(
			{
				label: fields.text({ label: "Label", required: true }),
				href: fields.url({ label: "URL", required: true }),
			},
			{ label: "Link" },
		),
		{ label: "Links", itemLabel: (item) => item.label },
	);

// -------------------------------------------------------------------------------------------------------------
// Collections
// -------------------------------------------------------------------------------------------------------------

export const media = createMediaCollection();

export const peopleCollection = collection({
	name: "people",
	label: "People",
	path: "people",
	slug: {
		from: "name",
		generate(name) {
			const segments = name.trim().split(" ");
			const lastName = segments.pop();
			return [lastName, ...segments].join(" ");
		},
	},
	list: { columns: ["name"] },
	fields: {
		name: fields.text({ label: "Name", required: true }),
		image: fields.image({ label: "Image", required: true, alt: "optional" }),
		social: createSocialField(),
		content: description(),
	},
});

export const tags = collection({
	name: "tags",
	label: "Tags",
	path: "tags",
	slug: { from: "name" },
	list: { columns: ["name"] },
	fields: {
		name: fields.text({ label: "Name", required: true }),
		content: description("Description"),
	},
});

export const sources = collection({
	name: "sources",
	label: "Sources",
	path: "sources",
	slug: { from: "name" },
	list: { columns: ["name"] },
	preview: { path: (entry) => `/sources/${entry.slug}` },
	fields: {
		name: fields.text({ label: "Name", required: true }),
		image: fields.image({ label: "Image", required: true, alt: "optional" }),
		content: description(),
	},
});

export const dariahNationalConsortia = collection({
	name: "dariah-national-consortia",
	label: "DARIAH national consortia",
	path: "dariah-national-consortia",
	slug: { from: "code" },
	list: { columns: ["name", "code"] },
	fields: {
		code: fields.text({ label: "Country code", required: true }),
		name: fields.text({ label: "Name", required: true }),
		sshocMarketplaceId: fields.text({ label: "SSHOC marketplace identifier", required: true }),
	},
});

export const dariahWorkingGroups = collection({
	name: "dariah-working-groups",
	label: "DARIAH working groups",
	path: "dariah-working-groups",
	slug: { from: "slug" },
	list: { columns: ["name"] },
	fields: {
		slug: fields.text({ label: "Working group slug", required: true }),
		name: fields.text({ label: "Name", required: true }),
		/** Missing for a third of the working groups. */
		sshocMarketplaceId: fields.text({ label: "SSHOC marketplace identifier" }),
	},
});

export const resourcesHosted = collection({
	name: "resources-hosted",
	label: "Hosted resources",
	path: "resources/hosted",
	slug: { from: "title" },
	list: { columns: ["title", "publicationDate"], sort: { field: "publicationDate", direction: "desc" } },
	preview: { path: (entry) => `/resources/hosted/${entry.slug}` },
	layout: "content",
	fields: {
		title: fields.text({ label: "Title", required: true }),
		...resourceMetadata(),
		authors: people("Authors", 1),
		editors: people("Editors"),
		contributors: people("Contributors"),
		tags: fields.relationship({ label: "Tags", collection: "tags", multiple: true, min: 1 }),
		sources: fields.relationship({ label: "Sources", collection: "sources", multiple: true, min: 1 }),
		featuredImage: featuredImage(),
		license: fields.select({ label: "License", options: contentLicenses, defaultValue: "cc-by-4.0" }),
		tableOfContents: fields.checkbox({ label: "Table of contents", defaultValue: true }),
		summary: createSummaryField(),
		contentType: fields.select({ label: "Content type", options: contentTypes, defaultValue: "training-module" }),
		content: content(componentSets["resources-hosted"]),
		...consortiaAndWorkingGroups(),
	},
});

export const resourcesExternal = collection({
	name: "resources-external",
	label: "External resources",
	path: "resources/external",
	slug: { from: "title" },
	list: { columns: ["title", "publicationDate"], sort: { field: "publicationDate", direction: "desc" } },
	preview: { path: (entry) => `/resources/external/${entry.slug}` },
	layout: "content",
	fields: {
		title: fields.text({ label: "Title", required: true }),
		...resourceMetadata(),
		authors: people("Authors", 1),
		editors: people("Editors"),
		contributors: people("Contributors"),
		tags: fields.relationship({ label: "Tags", collection: "tags", multiple: true, min: 1 }),
		sources: fields.relationship({ label: "Sources", collection: "sources", multiple: true, min: 1 }),
		featuredImage: featuredImage(),
		license: fields.select({ label: "License", options: contentLicenses, defaultValue: "cc-by-4.0" }),
		tableOfContents: fields.checkbox({ label: "Table of contents", defaultValue: false }),
		summary: createSummaryField(),
		remote: fields.object(
			{
				publicationDate: fields.date({ label: "Publication date", required: true }),
				url: fields.url({ label: "URL", required: true }),
				publisher: fields.text({ label: "Publisher", required: true }),
			},
			{ label: "Remote host" },
		),
		contentType: fields.select({ label: "Content type", options: contentTypes, defaultValue: "training-module" }),
		content: content(componentSets["resources-external"]),
		...consortiaAndWorkingGroups(),
	},
});

export const resourcesPathfinders = collection({
	name: "resources-pathfinders",
	label: "Pathfinders",
	path: "resources/pathfinders",
	slug: { from: "title" },
	list: { columns: ["title", "publicationDate"], sort: { field: "publicationDate", direction: "desc" } },
	preview: { path: (entry) => `/resources/pathfinders/${entry.slug}` },
	layout: "content",
	fields: {
		title: fields.text({ label: "Title", required: true }),
		...resourceMetadata(),
		authors: people("Authors", 1),
		editors: people("Editors"),
		contributors: people("Contributors"),
		tags: fields.relationship({ label: "Tags", collection: "tags", multiple: true, min: 1 }),
		sources: fields.relationship({ label: "Sources", collection: "sources", multiple: true, min: 1 }),
		featuredImage: featuredImage(),
		license: fields.select({ label: "License", options: contentLicenses, defaultValue: "cc-by-4.0" }),
		tableOfContents: fields.checkbox({ label: "Table of contents", defaultValue: true }),
		summary: createSummaryField(),
		content: content(componentSets["resources-pathfinders"]),
		...consortiaAndWorkingGroups(),
	},
});

function createSessionContent() {
	return content(componentSets["resources-events"]);
}

export const resourcesEvents = collection({
	name: "resources-events",
	label: "Events",
	path: "resources/events",
	slug: { from: "title" },
	list: { columns: ["title", "startDate"], sort: { field: "startDate", direction: "desc" } },
	preview: { path: (entry) => `/resources/events/${entry.slug}` },
	fields: {
		title: fields.text({ label: "Title", required: true }),
		...resourceMetadata(),
		startDate: fields.date({ label: "Start date", required: true }),
		endDate: fields.date({ label: "End date" }),
		location: fields.text({ label: "Location", required: true }),
		authors: people("Authors", 1),
		organisations: fields.array(
			fields.object(
				{
					name: fields.text({ label: "Name", required: true }),
					url: fields.url({ label: "URL", required: true }),
					logo: fields.image({ label: "Logo", required: true, alt: "optional" }),
				},
				{ label: "Organisation" },
			),
			{ label: "Organisations", itemLabel: (item) => item.name },
		),
		tags: fields.relationship({ label: "Tags", collection: "tags", multiple: true, min: 1 }),
		sources: fields.relationship({ label: "Sources", collection: "sources", multiple: true, min: 1 }),
		featuredImage: featuredImage(),
		license: fields.select({ label: "License", options: contentLicenses, defaultValue: "cc-by-4.0" }),
		tableOfContents: fields.checkbox({ label: "Table of contents", defaultValue: true }),
		attachments: attachments(),
		links: links(),
		social: createSocialField(),
		summary: createSummaryField(),
		content: createSessionContent(),
		sessions: fields.array(
			fields.object(
				{
					title: fields.text({ label: "Title", required: true }),
					speakers: people("Speakers"),
					attachments: attachments(),
					links: links(),
					content: createSessionContent(),
					presentations: fields.array(
						fields.object(
							{
								title: fields.text({ label: "Title", required: true }),
								speakers: people("Speakers"),
								attachments: attachments(),
								links: links(),
								content: createSessionContent(),
							},
							{ label: "Presentation" },
						),
						{ label: "Presentations", itemLabel: (item) => item.title },
					),
				},
				{ label: "Session" },
			),
			{ label: "Sessions", min: 1, itemLabel: (item) => item.title },
		),
		...consortiaAndWorkingGroups(),
	},
});

export const curricula = collection({
	name: "curricula",
	label: "Curricula",
	path: "curricula",
	slug: { from: "title" },
	list: { columns: ["title", "publicationDate"], sort: { field: "publicationDate", direction: "desc" } },
	preview: { path: (entry) => `/curricula/${entry.slug}` },
	fields: {
		title: fields.text({ label: "Title", required: true }),
		...resourceMetadata(),
		editors: people("Editors", 1),
		tags: fields.relationship({ label: "Tags", collection: "tags", multiple: true, min: 1 }),
		sources: fields.relationship({ label: "Sources", collection: "sources", multiple: true }),
		featuredImage: featuredImage(),
		license: fields.select({ label: "License", options: contentLicenses, defaultValue: "cc-by-4.0" }),
		summary: createSummaryField(),
		resources: fields.array(
			fields.union({
				label: "Collection",
				options: {
					"resources-hosted": fields.relationship({
						label: "Hosted resource",
						collection: "resources-hosted",
						required: true,
					}),
					"resources-events": fields.relationship({ label: "Event", collection: "resources-events", required: true }),
					"resources-pathfinders": fields.relationship({
						label: "Pathfinder",
						collection: "resources-pathfinders",
						required: true,
					}),
					"resources-external": fields.relationship({
						label: "External resource",
						collection: "resources-external",
						required: true,
					}),
				},
			}),
			{ label: "Resources", min: 1, itemLabel: (item) => item.kind },
		),
		content: content(componentSets.curricula),
		supplementaryInformation: content(componentSets.curricula, "Supplementary information"),
		...consortiaAndWorkingGroups(),
	},
});

export const documentation = collection({
	name: "documentation",
	label: "Documentation",
	path: "documentation",
	slug: { from: "title" },
	list: { columns: ["title"] },
	preview: { path: (entry) => `/documentation/${entry.slug}` },
	layout: "content",
	fields: {
		title: fields.text({ label: "Title", required: true }),
		lead: fields.text({ label: "Lead", required: true, multiline: true }),
		content: content(componentSets.documentation),
	},
});

// -------------------------------------------------------------------------------------------------------------
// Singletons
// -------------------------------------------------------------------------------------------------------------

const videoList = (label: string) =>
	fields.array(
		fields.object(
			{
				id: fields.text({ label: "YouTube ID", required: true }),
				title: fields.text({ label: "Title", required: true }),
				description: fields.text({ label: "Description", required: true, multiline: true }),
				image: fields.image({ label: "Image", required: true, alt: "optional" }),
			},
			{ label: "Video" },
		),
		{ label, min: 1, itemLabel: (item) => item.title },
	);

function videoSection(label: string) {
	return fields.object(
		{
			title: fields.text({ label: "Title", required: true }),
			lead: fields.text({ label: "Lead", required: true, multiline: true }),
			videos: videoList("Videos"),
		},
		{ label },
	);
}

export const indexPage = singleton({
	name: "index-page",
	label: "Home page",
	path: "index-page",
	preview: { path: () => "/" },
	fields: {
		title: fields.text({ label: "Title", required: true }),
		lead: fields.text({ label: "Lead", required: true, multiline: true }),
		image: fields.image({ label: "Image", required: true, alt: "optional" }),
		browseSection: fields.object(
			{
				title: fields.text({ label: "Title", required: true }),
				lead: fields.text({ label: "Lead", required: true, multiline: true }),
				links: fields.array(
					fields.object(
						{
							title: fields.text({ label: "Title", required: true }),
							description: fields.text({ label: "Description", required: true, multiline: true }),
							href: fields.url({ label: "URL", required: true, allowRelative: true }),
							image: fields.image({ label: "Image", required: true, alt: "optional" }),
						},
						{ label: "Link" },
					),
					{ label: "Links", min: 1, itemLabel: (item) => item.title },
				),
			},
			{ label: "Browse section" },
		),
		aboutSection: videoSection("About section"),
		faqSection: fields.object(
			{
				title: fields.text({ label: "Title", required: true }),
				lead: fields.text({ label: "Lead", required: true, multiline: true }),
				faq: fields.array(
					fields.object(
						{
							title: fields.text({ label: "Title", required: true }),
							content: fields.richText({
								label: "Content",
								blocks: { heading: false, blockquote: false, code: false, table: false },
								components: [],
							}),
						},
						{ label: "FAQ" },
					),
					{ label: "FAQ", min: 1, itemLabel: (item) => item.title },
				),
			},
			{ label: "FAQ section" },
		),
		testimonialSection: videoSection("Testimonial section"),
		teamSection: fields.object(
			{
				title: fields.text({ label: "Title", required: true }),
				lead: fields.text({ label: "Lead", required: true, multiline: true }),
				team: fields.array(
					fields.object(
						{
							person: fields.relationship({ label: "Person", collection: "people", required: true }),
							role: fields.text({ label: "Description", required: true }),
						},
						{ label: "Team member" },
					),
					{ label: "Team", min: 1 },
				),
			},
			{ label: "Team section" },
		),
	},
});

export const metadata = singleton({
	name: "metadata",
	label: "Metadata",
	path: "metadata",
	fields: {
		title: fields.text({ label: "Title", required: true }),
		description: fields.text({ label: "Description", required: true }),
		creator: fields.text({ label: "Creator", required: true }),
		manifest: fields.object(
			{
				name: fields.text({ label: "Name", required: true }),
				shortName: fields.text({ label: "Short name", required: true }),
				description: fields.text({ label: "Description", required: true }),
			},
			{ label: "Webmanifest" },
		),
		social: fields.array(
			fields.object(
				{
					kind: fields.select({ label: "Kind", options: socialMediaKinds, defaultValue: "website" }),
					/** A URL, a path on the site, or an email address, depending on the kind. */
					href: fields.text({ label: "URL" }),
				},
				{ label: "Social" },
			),
			{ label: "Social media", min: 1, itemLabel: (item) => item.kind },
		),
	},
});

export const navigation = singleton({
	name: "navigation",
	label: "Navigation",
	path: "navigation",
	fields: {
		links: fields.array(
			fields.union({
				label: "Item",
				options: {
					link: fields.object(
						{ label: fields.text({ label: "Label", required: true }), link: linkField },
						{ label: "Link" },
					),
					separator: fields.empty(),
				},
			}),
			{
				label: "Links",
				min: 1,
				itemLabel: (item) => (item.kind === "link" ? `${item.value.label} (${item.value.link.kind})` : "Separator"),
			},
		),
		documentation: fields.object(
			{ links: fields.relationship({ label: "Pages", collection: "documentation", multiple: true, min: 1 }) },
			{ label: "Documentation pages" },
		),
	},
});

export const legalNotice = singleton({
	name: "legal-notice",
	label: "Legal notice",
	path: "legal-notice",
	preview: { path: () => "/legal-notice" },
	fields: {
		content: fields.richText({ label: "Content", blocks: { heading: { levels: [2, 3, 4] } }, components: [] }),
	},
});

// -------------------------------------------------------------------------------------------------------------
// Schema
// -------------------------------------------------------------------------------------------------------------

export const schema = defineSchema({
	locales: ["en"],
	defaultLocale: "en",
	collections: [
		resourcesHosted,
		resourcesExternal,
		resourcesPathfinders,
		resourcesEvents,
		curricula,
		documentation,
		peopleCollection,
		tags,
		sources,
		dariahNationalConsortia,
		dariahWorkingGroups,
		media,
	],
	singletons: [indexPage, metadata, navigation, legalNotice],
});

export const roles = defineRoles({
	admin: { label: "Administrator", collections: { "*": "all" }, manageUsers: true },
	editor: {
		label: "Editor",
		collections: { "*": ["read", "create", "update", "delete", "review", "publish"] },
	},
	contributor: {
		label: "Contributor",
		collections: { "*": ["read", "create", "update"] },
	},
});
