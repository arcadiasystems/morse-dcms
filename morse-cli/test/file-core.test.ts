import { beforeEach, describe, expect, test } from "bun:test";
import {
	runFileDelete,
	runFileGet,
	runFileRecipientAdd,
	runFileRecipientList,
	runFileRecipientRemove,
	runFileRegister,
	runFileTransferOwnership,
	runFileUpdate,
} from "../src/commands/file.ts";
import { filesReadContext, writeContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);

const FILE = `0x${"9".repeat(64)}`;
const RECIPIENT = `0x${"7".repeat(64)}`;
const BLOB = "A".repeat(43); // 43 URL-safe base64 chars
const NEW_OWNER = `0x${"2".repeat(64)}`;
const SEAL_PREFIX = "0a0b0c";

function fileRecord(over: Record<string, unknown> = {}) {
	return {
		id: FILE,
		owner: NEW_OWNER,
		blobId: BLOB,
		blobObjectId: null,
		name: "doc.pdf",
		contentType: "application/pdf",
		size: 1024,
		members: [RECIPIENT],
		createdAtMs: 0,
		...over,
	};
}

describe("runFileGet", () => {
	test("renders the file metadata and recipients", async () => {
		const { ctx, captured } = filesReadContext({
			filesReader: { getRecipientFile: () => Promise.resolve(fileRecord()) },
		});
		await runFileGet(ctx, FILE);
		expect(captured.stdout()).toContain("doc.pdf");
		expect(captured.stdout()).toContain("recipients");
		expect(captured.stdout()).toContain(RECIPIENT);
	});
});

describe("runFileRegister", () => {
	const base = {
		blobId: BLOB,
		name: "doc.pdf",
		contentType: "application/pdf",
		size: "1024",
	};

	test("requires --public or --encrypted", async () => {
		const { ctx } = writeContext();
		await expect(runFileRegister(ctx, base)).rejects.toThrow(
			/--public|--encrypted/,
		);
		expect(ops.createRecipientFile).not.toHaveBeenCalled();
		expect(ops.createEncryptedRecipientFile).not.toHaveBeenCalled();
	});

	test("rejects both --public and --encrypted", async () => {
		const { ctx } = writeContext();
		await expect(
			runFileRegister(ctx, { ...base, public: true, encrypted: true }),
		).rejects.toThrow(/not both/);
	});

	test("encrypted: delegates with the seal prefix and recipients", async () => {
		const { ctx, captured } = writeContext();
		await runFileRegister(ctx, {
			...base,
			encrypted: true,
			sealPrefix: SEAL_PREFIX,
			recipient: [RECIPIENT],
		});
		expect(ops.createEncryptedRecipientFile).toHaveBeenCalledTimes(1);
		expect(ops.createEncryptedRecipientFile.mock.calls[0]?.[2]).toMatchObject({
			blobId: BLOB,
			size: 1024,
			recipients: [RECIPIENT],
		});
		expect(captured.stdout()).toContain("Registered encrypted file");
	});

	test("encrypted without --seal-prefix fails", async () => {
		const { ctx } = writeContext();
		await expect(
			runFileRegister(ctx, { ...base, encrypted: true }),
		).rejects.toThrow(/--seal-prefix/);
	});

	test("public: delegates createRecipientFile", async () => {
		const { ctx, captured } = writeContext();
		await runFileRegister(ctx, { ...base, public: true });
		expect(ops.createRecipientFile).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Registered public file");
	});
});

describe("runFileUpdate", () => {
	test("delegates updateRecipientFileMetadata", async () => {
		const { ctx, captured } = writeContext();
		await runFileUpdate(ctx, FILE, {
			name: "renamed.pdf",
			contentType: "application/pdf",
		});
		expect(ops.updateRecipientFileMetadata).toHaveBeenCalledTimes(1);
		expect(ops.updateRecipientFileMetadata.mock.calls[0]?.[2]).toMatchObject({
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
		expect(ops.transferRecipientFileOwnership).not.toHaveBeenCalled();
	});

	test("with --yes transfers", async () => {
		const { ctx, captured } = writeContext();
		await runFileTransferOwnership(ctx, FILE, NEW_OWNER, { yes: true });
		expect(ops.transferRecipientFileOwnership).toHaveBeenCalledTimes(1);
		expect(ops.transferRecipientFileOwnership.mock.calls[0]?.[2]).toMatchObject(
			{
				newOwner: NEW_OWNER,
			},
		);
		expect(captured.stdout()).toContain("Transferred file ownership");
	});
});

describe("runFileDelete", () => {
	test("aborts without --yes", async () => {
		const { ctx } = writeContext();
		await expect(runFileDelete(ctx, FILE, {})).rejects.toThrow(/--yes/);
		expect(ops.deleteRecipientFile).not.toHaveBeenCalled();
	});

	test("with --yes deletes", async () => {
		const { ctx, captured } = writeContext();
		await runFileDelete(ctx, FILE, { yes: true });
		expect(ops.deleteRecipientFile).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Deleted file");
	});
});

describe("runFileRecipientAdd", () => {
	test("delegates addRecipient", async () => {
		const { ctx, captured } = writeContext();
		await runFileRecipientAdd(ctx, FILE, RECIPIENT);
		expect(ops.addRecipient).toHaveBeenCalledTimes(1);
		expect(ops.addRecipient.mock.calls[0]?.[2]).toMatchObject({
			recipient: RECIPIENT,
		});
		expect(captured.stdout()).toContain("Added");
	});
});

describe("runFileRecipientRemove", () => {
	test("delegates removeRecipient", async () => {
		const { ctx, captured } = writeContext();
		await runFileRecipientRemove(ctx, FILE, RECIPIENT);
		expect(ops.removeRecipient).toHaveBeenCalledTimes(1);
		expect(ops.removeRecipient.mock.calls[0]?.[2]).toMatchObject({
			recipient: RECIPIENT,
		});
		expect(captured.stdout()).toContain("Removed");
	});
});

describe("runFileRecipientList", () => {
	test("lists the file's recipients", async () => {
		const { ctx, captured } = filesReadContext({
			filesReader: { getRecipientFile: () => Promise.resolve(fileRecord()) },
		});
		await runFileRecipientList(ctx, FILE);
		expect(captured.stdout()).toContain(RECIPIENT);
	});

	test("reports an empty recipient list", async () => {
		const { ctx, captured } = filesReadContext({
			filesReader: {
				getRecipientFile: () => Promise.resolve(fileRecord({ members: [] })),
			},
		});
		await runFileRecipientList(ctx, FILE);
		expect(captured.stdout()).toContain("No recipients.");
	});
});
