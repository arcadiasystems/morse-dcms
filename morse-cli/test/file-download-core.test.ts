import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { runFileDownload } from "../src/commands/file.ts";
import { useTempFiles } from "./support/content.ts";
import { fileDownloadContext } from "./support/context.ts";

const files = useTempFiles();
const FILE = `0x${"9".repeat(64)}`;
const ALLOWLIST = `0x${"7".repeat(64)}`;
const BLOB = "A".repeat(43);

function fileRecord(over: Record<string, unknown>) {
	return {
		id: FILE,
		owner: `0x${"a".repeat(64)}`,
		blobId: BLOB,
		blobObjectId: null,
		name: "doc.txt",
		contentType: "text/plain",
		size: 6,
		encrypted: false,
		allowlistId: null,
		...over,
	};
}

describe("runFileDownload", () => {
	test("--json without --out is a usage error", async () => {
		const { ctx } = fileDownloadContext({ json: true });
		await expect(runFileDownload(ctx, FILE, {})).rejects.toThrow(/--out/);
	});

	test("public file: writes the fetched bytes to --out without a signer", async () => {
		const out = files.path("download.txt");
		const { ctx, captured } = fileDownloadContext({
			filesReader: {
				getEncryptedFile: () =>
					Promise.resolve(fileRecord({ encrypted: false })),
			},
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("public")),
			},
		});
		await runFileDownload(ctx, FILE, { out });
		expect(await readFile(out, "utf8")).toBe("public");
		expect(captured.stdout()).toContain(`Wrote 6 bytes to ${out}`);
	});

	test("encrypted file without --seal-id is a usage error", async () => {
		const out = files.path("nope.txt");
		const { ctx } = fileDownloadContext({
			filesReader: {
				getEncryptedFile: () =>
					Promise.resolve(
						fileRecord({ encrypted: true, allowlistId: ALLOWLIST }),
					),
			},
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("cipher")),
			},
		});
		await expect(runFileDownload(ctx, FILE, { out })).rejects.toThrow(
			/--seal-id/,
		);
	});
});
