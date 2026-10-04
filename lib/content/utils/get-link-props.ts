import { createHref } from "#/lib/navigation/create-href.ts";

interface EntryLink<TCollection extends string> {
	discriminant: TCollection;
	value: { id: string; hash: string };
}

/** Links as the content components receive them; `lib/cms/site/client.ts` converts cms link values to this shape. */
export type LinkSchema =
	| { discriminant: "external"; value: string }
	| { discriminant: "hash"; value: string }
	| { discriminant: "download"; value: string }
	| { discriminant: "email"; value: string }
	| { discriminant: "search"; value: { search: string; hash: string } }
	| EntryLink<"resources-events">
	| EntryLink<"resources-external">
	| EntryLink<"resources-hosted">
	| EntryLink<"resources-pathfinders">
	| EntryLink<"curricula">
	| EntryLink<"documentation">;

// oxlint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function getLinkProps(params: LinkSchema) {
	switch (params.discriminant) {
		case "curricula": {
			return {
				href: createHref({
					pathname: `/curricula/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "documentation": {
			return {
				href: createHref({
					pathname: `/documentation/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "download": {
			return {
				download: true,
				href: params.value,
			};
		}

		case "email": {
			return {
				href: `mailto:${params.value}`,
			};
		}

		case "external": {
			return {
				href: params.value,
			};
		}

		case "hash": {
			return {
				href: createHref({
					hash: params.value,
				}),
			};
		}

		case "resources-events": {
			return {
				href: createHref({
					pathname: `/resources/events/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "resources-external": {
			return {
				href: createHref({
					pathname: `/resources/external/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "resources-hosted": {
			return {
				href: createHref({
					pathname: `/resources/hosted/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "resources-pathfinders": {
			return {
				href: createHref({
					pathname: `/resources/pathfinders/${params.value.id}`,
					hash: params.value.hash,
				}),
			};
		}

		case "search": {
			return {
				href: createHref({
					pathname: "/search",
					searchParams: params.value.search,
				}),
			};
		}
	}
}
