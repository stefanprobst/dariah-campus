/**
 * Uploads the files of all media entries to the media store configured with `CMS_S3_*` (see `lib/cms/stores.ts`), from
 * the output of `pnpm cms:migrate --copy-media`. Files which are already stored are skipped, so it can run repeatedly.
 *
 * Usage: `tsx ./scripts/cms/upload-media.ts [--output <dir>] [--concurrency <n>]`
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { log } from "@acdh-oeaw/lib";
import pLimit from "p-limit";

import { env } from "#/configs/env.config.ts";
import { mediaStore } from "#/lib/cms/stores.ts";

const { values: args } = parseArgs({
	options: {
		output: { type: "string", default: ".cms-migration" },
		concurrency: { type: "string", default: "4" },
	},
});

const root = path.resolve(args.output);

interface MediaEntryFile {
	data: { file: { key: string; filename: string; contentType: string; size: number } };
}

async function getMediaFiles(): Promise<Array<MediaEntryFile["data"]["file"]>> {
	const directory = path.join(root, "content", "en", "media");
	const files = [];
	for (const slug of await fs.readdir(directory)) {
		const entry = JSON.parse(await fs.readFile(path.join(directory, slug, "index.json"), "utf-8")) as MediaEntryFile;
		files.push(entry.data.file);
	}
	return files;
}

async function upload(): Promise<{ uploaded: number; skipped: number }> {
	if (env.CMS_S3_ENDPOINT == null) {
		throw new Error("Set `CMS_S3_*` to upload to an S3-compatible bucket.");
	}
	const files = await getMediaFiles();
	const limit = pLimit(Number(args.concurrency));
	let uploaded = 0;
	let skipped = 0;

	await Promise.all(
		files.map((file) =>
			limit(async () => {
				const bytes = await fs.readFile(path.join(root, "media-files", file.key));
				const sha256 = createHash("sha256").update(bytes).digest("hex");
				const target = await mediaStore.createUpload({
					sha256,
					size: bytes.byteLength,
					contentType: file.contentType,
					filename: file.filename,
				});
				if (target.key !== file.key) {
					throw new Error(`"${file.filename}" would be stored as "${target.key}", not "${file.key}".`);
				}
				if (target.kind === "exists") {
					skipped++;
					return;
				}
				const response = await fetch(target.url, { method: "PUT", headers: target.headers, body: bytes });
				if (!response.ok) {
					throw new Error(`Uploading "${file.filename}" failed: ${String(response.status)}.`);
				}
				await mediaStore.completeUpload(target.key, sha256);
				uploaded++;
				if (uploaded % 100 === 0) {
					log.info(`Uploaded ${String(uploaded)} files.`);
				}
			}),
		),
	);

	return { uploaded, skipped };
}

upload()
	.then(({ skipped, uploaded }) => {
		log.success(`Uploaded ${String(uploaded)} files, ${String(skipped)} were stored already.`);
	})
	.catch((error: unknown) => {
		log.error("Failed to upload media.\n", error);
		process.exitCode = 1;
	});
