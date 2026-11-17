import { beforeEach, describe, expect, test } from "bun:test";
import { CliError } from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";
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

function publisherCapReader(
	over: { storageMode?: string; revoked?: boolean } = {},
) {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
				nextCursor: null,
			}),
		getPublication: () =>
			Promise.resolve({
				id: ID,
				collections: [
					{
						name: "vault",
						storageMode: over.storageMode ?? "blob",
						nextEntryId: 0,
					},
				],
			}),
		isPublisherCapRevoked: () => Promise.resolve(over.revoked === true),
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

	test("refuses a revoked PublisherCap with exit 4 before encrypting or uploading", async () => {
		const file = await files.write("secret.txt", "classified");
		const { ctx } = encryptContext({
			reader: publisherCapReader({ revoked: true }),
		});
		const error = await runEntryAddEncrypted(ctx, "secret", {
			publication: ID,
			collection: "vault",
			epochs: "3",
			file,
		}).catch((err: unknown) => err);
		expect(error).toBeInstanceOf(CliError);
		expect((error as CliError).exitCode).toBe(ExitCode.Auth);
		expect((error as CliError).message).toBe(
			"The PublisherCap has been revoked and can no longer be used.",
		);
		// addEncryptedEntryFromBytes is the op that encrypts and uploads.
		expect(ops.addEncryptedEntryFromBytes).not.toHaveBeenCalled();
	});

	test("refuses a quilt collection with exit 2 before encrypting or uploading", async () => {
		const file = await files.write("secret.txt", "classified");
		const { ctx } = encryptContext({
			reader: publisherCapReader({ storageMode: "quilt" }),
		});
		const error = await runEntryAddEncrypted(ctx, "secret", {
			publication: ID,
			collection: "vault",
			epochs: "3",
			file,
		}).catch((err: unknown) => err);
		expect(error).toBeInstanceOf(CliError);
		expect((error as CliError).exitCode).toBe(ExitCode.Usage);
		expect((error as CliError).message).toContain(
			"`entry add-encrypted` does not support yet",
		);
		expect(ops.addEncryptedEntryFromBytes).not.toHaveBeenCalled();
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

	test("an explicit public index names the encrypted revisions", async () => {
		let fetched = false;
		const { ctx } = decryptContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...encryptedEntry([
							{
								id: 0,
								contentType: "text/plain",
								blobRef: {
									kind: "blob",
									blobObjectId: `0x${"9".repeat(64)}`,
								},
								author: AUTHOR,
								encrypted: true,
								sealId: new Uint8Array([1, 2, 3]),
							},
							{
								id: 1,
								contentType: "text/plain",
								blobRef: {
									kind: "blob",
									blobObjectId: `0x${"8".repeat(64)}`,
								},
								author: AUTHOR,
								encrypted: false,
								sealId: null,
							},
						]),
						publicHead: 1,
						draftHead: 0,
					}),
			} as never,
			walrusRead: {
				readBlobRef: () => {
					fetched = true;
					return Promise.resolve(new Uint8Array());
				},
			},
		});
		await expect(
			runEntryDecrypt(ctx, "0", "1", {
				publication: ID,
				collection: "vault",
			}),
		).rejects.toThrow(/Encrypted revision indexes: 0/);
		expect(fetched).toBe(false);
	});

	test("defaults to the latest encrypted revision after a public release", async () => {
		const encryptedBlob = `0x${"9".repeat(64)}`;
		let requested: unknown;
		const { ctx } = decryptContext({
			reader: {
				getEntry: () =>
					Promise.resolve({
						...encryptedEntry([
							{
								id: 0,
								contentType: "text/plain",
								blobRef: { kind: "blob", blobObjectId: encryptedBlob },
								author: AUTHOR,
								encrypted: true,
								sealId: new Uint8Array([1, 2, 3]),
							},
							{
								id: 1,
								contentType: "text/plain",
								blobRef: {
									kind: "blob",
									blobObjectId: `0x${"8".repeat(64)}`,
								},
								author: AUTHOR,
								encrypted: false,
								sealId: null,
							},
						]),
						publicHead: 1,
						draftHead: 0,
					}),
				listPublisherCapsOwnedBy: () =>
					Promise.resolve({
						results: [{ id: `0x${"d".repeat(64)}`, publicationId: ID }],
						nextCursor: null,
					}),
			} as never,
			walrusRead: {
				readBlobRef: (ref: unknown) => {
					requested = ref;
					return Promise.reject(new Error("stop after selection"));
				},
			},
		});
		await expect(
			runEntryDecrypt(ctx, "0", undefined, {
				publication: ID,
				collection: "vault",
			}),
		).rejects.toThrow(/stop after selection/);
		expect(requested).toEqual({ kind: "blob", blobObjectId: encryptedBlob });
	});
});
