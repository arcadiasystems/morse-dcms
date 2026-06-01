import { beforeEach, describe, expect, test } from "bun:test";
import {
	runEntryAddEncrypted,
	runEntryDecrypt,
} from "../src/commands/encrypted.ts";
import { useTempFiles } from "./support/content.ts";
import { decryptContext, encryptContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);
const files = useTempFiles();

const ID = `0x${"1".repeat(64)}`;
const AUTHOR = `0x${"a".repeat(64)}`;

function publisherCapReader() {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
	} as never;
}

function encryptedEntry(revisions: unknown[]) {
	return {
		id: 0,
		name: "secret",
		publicHead: null,
		draftHead: revisions.length > 0 ? 0 : null,
		revisions,
	};
}

describe("runEntryAddEncrypted", () => {
	test("encrypts file bytes and delegates with a seal id", async () => {
		const file = await files.write("secret.txt", "classified");
		const { ctx, captured } = encryptContext({ reader: publisherCapReader() });
		await runEntryAddEncrypted(ctx, "secret", {
			publication: ID,
			collection: "vault",
			epochs: "3",
			file,
		});
		expect(ops.addEncryptedEntryFromBytes).toHaveBeenCalledTimes(1);
		const args = ops.addEncryptedEntryFromBytes.mock.calls[0]?.[2] as {
			name: string;
			sealId: unknown;
		};
		expect(args.name).toBe("secret");
		expect(args.sealId).toBeDefined();
		expect(captured.stdout()).toContain('Added encrypted entry #0 "secret"');
	});
});

describe("runEntryDecrypt guards", () => {
	test("--json without --out is a usage error", async () => {
		const { ctx } = decryptContext({ json: true, reader: {} as never });
		await expect(
			runEntryDecrypt(ctx, "0", undefined, {
				publication: ID,
				collection: "vault",
			}),
		).rejects.toThrow(/--out/);
	});

	test("errors when the entry has no revisions", async () => {
		const { ctx } = decryptContext({
			reader: { getEntry: () => Promise.resolve(encryptedEntry([])) } as never,
		});
		await expect(
			runEntryDecrypt(ctx, "0", undefined, {
				publication: ID,
				collection: "vault",
			}),
		).rejects.toThrow(/no revisions/);
	});

	test("refuses a non-encrypted revision", async () => {
		const { ctx } = decryptContext({
			reader: {
				getEntry: () =>
					Promise.resolve(
						encryptedEntry([
							{
								id: 0,
								contentType: "text/plain",
								blobRef: { kind: "blob", blobObjectId: `0x${"9".repeat(64)}` },
								author: AUTHOR,
								encrypted: false,
								sealId: null,
							},
						]),
					),
			} as never,
		});
		await expect(
			runEntryDecrypt(ctx, "0", undefined, {
				publication: ID,
				collection: "vault",
			}),
		).rejects.toThrow(/not encrypted/);
	});
});
