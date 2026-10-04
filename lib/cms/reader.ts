import "server-nodejs-only";

import { type Reader, createReader } from "@stefanprobst/cms/reader";

import { schema } from "#/lib/cms/schema.ts";
import { content } from "#/lib/cms/stores.ts";

/** Published content. Also usable outside of next.js, e.g. in the search index and metadata scripts. */
export const publishedReader: Reader<typeof schema> = createReader({ schema, store: content });
