import { beforeEach, describe, expect, test } from "bun:test";
import {
	runFileDelete,
	runFileGet,
	runFileRegister,
	runFileTransferOwnership,
	runFileUpdate,
} from "../src/commands/file.ts";
import { filesReadContext, writeContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);

const FILE = `0x${"9".repeat(64)}`;
const ALLOWLIST = `0x${"7".repeat(64)}`;
const BLOB = "A".repeat(43); // 43 URL-safe base64 chars
const NEW_OWNER = `0x${"2".repeat(64)}`;

describe("runFileGet", () => {
	test("renders the file metadata", async () => {
		const { ctx, captured } = filesReadContext({
			filesReader: {
				getEncryptedFile: () =>
					Promise.resolve({
						id: FILE,
						owner: NEW_OWNER,
						blobId: BLOB,
						blobObjectId: null,
						name: "doc.pdf",
						contentType: "application/pdf",
						size: 1024,
						encrypted: true,
						allowlistId: ALLOWLIST,
						createdAtMs: 0,
					}),
			},
		});
		await runFileGet(ctx, FILE);
		expect(captured.stdout()).toContain("doc.pdf");
		expect(captured.stdout()).toContain("allowlist:");
	});
});

describe("runFileRegister", () => {
	const base = {
		blobId: BLOB,
		name: "doc.pdf",
		contentType: "application/pdf",
		size: "1024",
	};

	test("requires --allowlist or --public", async () => {
		const { ctx } = writeContext();
		await expect(runFileRegister(ctx, base)).rejects.toThrow(
			/--allowlist|--public/,
		);
		expect(ops.createEncryptedFile).not.toHaveBeenCalled();
		expect(ops.createPublicFile).not.toHaveBeenCalled();
	});

	test("encrypted: delegates with the allowlist and bigint size", async () => {
		const { ctx, captured } = writeContext();
		await runFileRegister(ctx, { ...base, allowlist: ALLOWLIST });
		expect(ops.createEncryptedFile).toHaveBeenCalledTimes(1);
		expect(ops.createEncryptedFile.mock.calls[0]?.[2]).toMatchObject({
			allowlistId: ALLOWLIST,
			blobId: BLOB,
			size: 1024n,
		});
		expect(captured.stdout()).toContain("Registered encrypted file");
	});

	test("public: delegates createPublicFile", async () => {
		const { ctx, captured } = writeContext();
		await runFileRegister(ctx, { ...base, public: true });
		expect(ops.createPublicFile).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Registered public file");
	});
});

describe("runFileUpdate", () => {
	test("delegates updateFileMetadata", async () => {
		const { ctx, captured } = writeContext();
		await runFileUpdate(ctx, FILE, {
			name: "renamed.pdf",
			contentType: "application/pdf",
		});
		expect(ops.updateFileMetadata).toHaveBeenCalledTimes(1);
		expect(ops.updateFileMetadata.mock.calls[0]?.[2]).toMatchObject({
			name: "renamed.pdf",
		});
		expect(captured.stdout()).toContain("Updated file");
	});
});

describe("runFileTransferOwnership", () => {
	test("aborts without --yes", async () => {
		const { ctx } = writeContext();
		await expect(
			runFileTransferOwnership(ctx, FILE, NEW_OWNER, {}),
		).rejects.toThrow(/--yes/);
		expect(ops.transferFileOwnership).not.toHaveBeenCalled();
	});

	test("with --yes transfers", async () => {
		const { ctx, captured } = writeContext();
		await runFileTransferOwnership(ctx, FILE, NEW_OWNER, { yes: true });
		expect(ops.transferFileOwnership).toHaveBeenCalledTimes(1);
		expect(ops.transferFileOwnership.mock.calls[0]?.[2]).toMatchObject({
			newOwner: NEW_OWNER,
		});
		expect(captured.stdout()).toContain("Transferred file ownership");
	});
});

describe("runFileDelete", () => {
	test("aborts without --yes", async () => {
		const { ctx } = writeContext();
		await expect(runFileDelete(ctx, FILE, {})).rejects.toThrow(/--yes/);
		expect(ops.deleteFile).not.toHaveBeenCalled();
	});

	test("with --yes deletes", async () => {
		const { ctx, captured } = writeContext();
		await runFileDelete(ctx, FILE, { yes: true });
		expect(ops.deleteFile).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Deleted file");
	});
});
