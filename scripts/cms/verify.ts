/**
 * Checks the output of `scripts/cms/migrate.ts`: every entry is read back through the CMS reader, which validates it,
 * and every reference must point to an existing entry. References to entries which are still drafts are listed
 * separately, because they resolve once the drafts are published.
 *
 * Usage: `tsx ./scripts/cms/verify.ts [--output <dir>]`
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { log } from "@acdh-oeaw/lib";
import { createFsContentStore } from "@stefanprobst/cms/adapters/fs";
import { createJsonEntryFormat } from "@stefanprobst/cms/core";
import { createReader } from "@stefanprobst/cms/reader";
import { getReferences } from "@stefanprobst/cms/schema";

import { schema } from "#/lib/cms/schema.ts";

const { values: args } = parseArgs({ options: { output: { type: "string", default: ".cms-migration" } } });
const root = path.resolve(args.output);
const format = createJsonEntryFormat({ schema });

interface Entry {
	collection: string;
	slug: string;
	data: unknown;
}

async function verify(): Promise<void> {
	const reader = createReader({ schema, store: createFsContentStore({ root, format }) });
	const drafts = createReader({ schema, store: createFsContentStore({ root, format, contentDirectory: "drafts" }) });

	const ids = new Map<string, Set<string>>();
	const draftIds = new Set<string>();
	const entries: Array<Entry> = [];

	for (const collection of schema.collections) {
		const name = collection.name as never;
		const published = await reader.collection(name).list();
		ids.set(collection.name, new Set(published.map((entry) => entry.id)));
		for (const entry of published) {
			entries.push({ collection: collection.name, slug: entry.slug, data: entry.data });
		}
		for (const entry of await drafts.collection(name).list()) {
			draftIds.add(entry.id);
		}
	}
	for (const singleton of schema.singletons) {
		const entry = await reader.singleton(singleton.name as never).get();
		entries.push({ collection: singleton.name, slug: "", data: entry?.data });
	}

	const missing: Array<string> = [];
	const toDrafts: Array<string> = [];
	for (const entry of entries) {
		for (const reference of getReferences(schema.get(entry.collection)!, entry.data)) {
			const target = reference.kind === "media" ? "media" : reference.collection;
			if (ids.get(target)?.has(reference.id) === true) {
				continue;
			}
			const message = `${entry.collection}/${entry.slug}: ${target} ${reference.id}`;
			(draftIds.has(reference.id) ? toDrafts : missing).push(message);
		}
	}

	await fs.writeFile(path.join(root, "verify.json"), `${JSON.stringify({ toDrafts, missing }, null, "\t")}\n`);
	log.info(`Read ${String(entries.length)} entries.`);
	if (toDrafts.length > 0) {
		log.warn(`${String(toDrafts.length)} references to drafts:\n${toDrafts.join("\n")}`);
	}
	if (missing.length > 0) {
		throw new Error(`${String(missing.length)} missing references:\n${missing.join("\n")}`);
	}
}

verify()
	.then(() => {
		log.success("Verified the converted content.");
	})
	.catch((error: unknown) => {
		log.error("Failed to verify the converted content.\n", error);
		process.exitCode = 1;
	});
