"use client";

import { CmsAdmin } from "@stefanprobst/cms/admin";
import type { ReactNode } from "react";

import { roles, schema } from "#/lib/cms/schema.ts";

/** The schema contains functions, so it is imported in a client module rather than passed as props. */
export function Admin(): ReactNode {
	return <CmsAdmin basePath="/admin" roles={roles} schema={schema} />;
}
