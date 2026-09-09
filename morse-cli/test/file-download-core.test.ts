import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { runFileDownload } from "../src/commands/file.ts";
import { useTempFiles } from "./support/content.ts";
import { fileDownloadContext } from "./support/context.ts";

const files = useTempFiles();
const FILE = `0x${"9".repeat(64)}`;
const OTHER = `0x${"1".repeat(64)}`;
const BLOB = "A".repeat(43);

function fileRecord(over: Record<string, unknown> = {}) {
	return {
		id: FILE,
		owner: `0x${"a".repeat(64)}`,
		blobId: BLOB,
		blobObjectId: null,
		name: "doc.txt",
		contentType: "text/plain",
		size: 6,
		// The Move contract auto-includes the owner, so a real file always has
		// at least one member, public or not. Modelling this as [] is what let
		// the old members-based encryption check pass here while refusing every
		// public file on chain.
		members: [`0x${"a".repeat(64)}`],
		createdAtMs: 0,
		...over,
	};
}

/** filesReader stub: `sealPrefix` null means public, bytes mean encrypted. */
function reader(
	sealPrefix: Uint8Array | null,
	over: Record<string, unknown> = {},
) {
	return {
		getRecipientFile: () => Promise.resolve(fileRecord(over)),
		getRecipientFileSealPrefix: () => Promise.resolve(sealPrefix),
	};
}

describe("runFileDownload", () => {
	test("--json without --out is a usage error", async () => {
		const { ctx } = fileDownloadContext({ json: true });
		await expect(runFileDownload(ctx, FILE, {})).rejects.toThrow(/--out/);
	});

	test("no file id and no --share is a usage error", async () => {
		const { ctx } = fileDownloadContext();
		await expect(
			runFileDownload(ctx, undefined, { out: files.path("x") }),
		).rejects.toThrow(/--share/);
	});

	test("--prefix without --nonce is a usage error", async () => {
		const { ctx } = fileDownloadContext();
		await expect(
			runFileDownload(ctx, FILE, { out: files.path("x"), prefix: "0a" }),
		).rejects.toThrow(/--prefix and --nonce/);
	});

	test("public file: writes the fetched bytes to --out without a signer", async () => {
		const out = files.path("download.txt");
		const { ctx, captured } = fileDownloadContext({
			filesReader: reader(null),
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("public")),
			},
		});
		await runFileDownload(ctx, FILE, { out });
		expect(await readFile(out, "utf8")).toBe("public");
		expect(captured.stdout()).toContain(`Wrote 6 bytes to ${out}`);
	});

	test("refuses to write ciphertext for an encrypted file without a decrypt option", async () => {
		const { ctx } = fileDownloadContext({
			filesReader: reader(new Uint8Array([1, 2, 3])),
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("cipher")),
			},
		});
		await expect(
			runFileDownload(ctx, FILE, { out: files.path("x") }),
		).rejects.toThrow(/--share|--raw/);
	});

	test("a public file with members downloads without --raw", async () => {
		// The exact shipped bug: every real file has members, so the old check
		// refused public downloads and told the user their plaintext was
		// unusable ciphertext.
		const out = files.path("public-with-members.txt");
		const { ctx } = fileDownloadContext({
			filesReader: reader(null, {
				members: [`0x${"a".repeat(64)}`, `0x${"7".repeat(64)}`],
			}),
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("public")),
			},
		});
		await runFileDownload(ctx, FILE, { out });
		expect(await readFile(out, "utf8")).toBe("public");
	});

	test("--raw writes the ciphertext with a warning", async () => {
		const out = files.path("ciphertext.bin");
		const { ctx, captured } = fileDownloadContext({
			filesReader: reader(new Uint8Array([1, 2, 3])),
			walrusRead: {
				readBlob: () => Promise.resolve(new TextEncoder().encode("cipher")),
			},
		});
		await runFileDownload(ctx, FILE, { out, raw: true });
		expect(captured.stderr()).toContain("raw ciphertext");
		expect(await readFile(out, "utf8")).toBe("cipher");
	});

	test("--share whose file id mismatches the positional is a usage error", async () => {
		const { ctx } = fileDownloadContext();
		// A share string whose embedded file id is OTHER, not FILE.
		const { encodeShare } = await import("../src/format/share.ts");
		const share = encodeShare(
			OTHER,
			new Uint8Array([1, 2]),
			new Uint8Array([3, 4]),
		);
		await expect(
			runFileDownload(ctx, FILE, { out: files.path("x"), share }),
		).rejects.toThrow(/does not match/);
	});
});
