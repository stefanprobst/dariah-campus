import { cache } from "react";

import { getReader } from "#/lib/cms/server.ts";
import { type SiteClient, getSiteClient } from "#/lib/cms/site/client.ts";

/**
 * Content for the current request: the previewed change set in draft mode, published content otherwise. Checking for
 * content changes reads the content directory, so it happens once per request.
 */
export const createClient = cache(async (): Promise<SiteClient> => getSiteClient(await getReader()));
