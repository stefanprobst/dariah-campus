import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { log } from "@acdh-oeaw/lib";
import { read } from "to-vfile";
import * as v from "valibot";
import { matter } from "vfile-matter";
import * as YAML from "yaml";

import { env } from "#/configs/env.config.ts";
import { createHandle } from "#/lib/server/handle/create-handle.ts";
import { createResourceUrl } from "#/lib/server/handle/create-resource-url.ts";

const ArgsInputSchema = v.object({
	resource: v.pipe(v.string(), v.nonEmpty()),
});

async function create() {
	const isProductionEnvironment = env.VERCEL_ENV === "production";
	const isMainBranch = env.VERCEL_GIT_COMMIT_REF === "main";

	if (!isProductionEnvironment || !isMainBranch) {
		return null;
	}

	const args = parseArgs({ options: { resource: { type: "string", short: "r" } } });
	const { resource: path } = v.parse(ArgsInputSchema, args.values);

	/** External resources are hosted elsewhere and must not be assigned a handle. */
	if (/[/\\]resources[/\\]external[/\\]/.test(path)) {
		return null;
	}

	const absoluteFilePath = join(process.cwd(), path);

	/** Cms entries keep their data in `index.json`, with the handle in `data.doi`. */
	if (path.endsWith(".json")) {
		const entry = JSON.parse(await readFile(absoluteFilePath, { encoding: "utf-8" })) as {
			data: { doi?: string | null };
		};
		if (entry.data.doi != null && entry.data.doi !== "") {
			return null;
		}
		const handle = await createHandle(createResourceUrl(path));
		entry.data.doi = String(handle);
		await writeFile(absoluteFilePath, `${JSON.stringify(entry, null, "\t")}\n`, { encoding: "utf-8" });
		return handle;
	}

	const vfile = await read(absoluteFilePath, { encoding: "utf-8" });
	matter(vfile, { strip: true });
	const metadata = vfile.data.matter as { doi?: string };

	// oxlint-disable-next-line @typescript-eslint/strict-boolean-expressions
	if (metadata.doi) {
		return null;
	}

	const resourceUrl = createResourceUrl(path);
	const handle = await createHandle(resourceUrl);

	await writeFile(
		absoluteFilePath,
		["---\n", YAML.stringify({ ...metadata, doi: String(handle) }), "---\n", String(vfile)],
		{ encoding: "utf-8" },
	);

	return handle;
}

create()
	.then((handle) => {
		if (handle != null) {
			log.success(`Successfully created handle "${handle}".`);
		} else {
			log.info("Skipped creating handle.");
		}
	})
	.catch((error: unknown) => {
		log.error("Failed to create handle.\n", error);
		process.exitCode = 1;
	});
