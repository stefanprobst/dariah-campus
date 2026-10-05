"use client";

import { CmsAdmin } from "@stefanprobst/cms/admin";
import type { ReactNode } from "react";

import { previews } from "#/lib/cms/previews/index.ts";
import { roles, schema } from "#/lib/cms/schema.ts";

/** The schema contains functions, so it is imported in a client module rather than passed as props. */
export function Admin(): ReactNode {
	return <CmsAdmin basePath="/admin" components={previews} roles={roles} schema={schema} />;
}
