import { describe, expect, test } from "bun:test";
import type { Signer } from "@mysten/sui/cryptography";
import {
	NotEnoughBlobConfirmationsError,
	UserAbortError,
	type WriteBlobFlow,
} from "@mysten/walrus";

import { TransportError, ValidationError } from "../errors.js";
import { QUILT_PATCH_ID_LENGTH, type WalrusBlobId } from "../types.js";
import { DefaultWalrusWriteAdapter } from "./default-adapter.js";
import {
	encodeQuiltPatchId,
	QUILT_PATCH_ID_VERSION,
	quiltPatchIdToString,
} from "./quilt-patch-id.js";

const FAKE_SIGNER = {} as Signer;
const SAMPLE_BLOB_ID =
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as WalrusBlobId;
const SUI_OBJECT_ID =
	"0xd1dd47c84e7c2f217a8b5a4fcec849a3b985df4fada82f72b72602423d8d018e";

interface FakeWalrusClient {
	writeBlob(args: {
		blob: Uint8Array;
		deletable: boolean;
		epochs: number;
		signer: Signer;
		owner?: string;
		signal?: AbortSignal;
	}): Promise<{ blobId: string; blobObject: { id: string } }>;
	writeQuilt(args: {
		blobs: Array<{
			contents: Uint8Array;
			identifier: string;
			tags?: Record<string, string>;
		}>;
		deletable: boolean;
		epochs: number;
		signer: Signer;
		owner?: string;
		signal?: AbortSignal;
	}): Promise<{
		blobId: string;
		blobObject: { id: string };
		index: {
			patches: Array<{
				patchId: string;
				startIndex: number;
				endIndex: number;
				identifier: string;
			}>;
		};
	}>;
	writeBlobFlow(options: { blob: Uint8Array }): WriteBlobFlow;
}

interface CallLog {
	writeBlob: unknown[];
	writeQuilt: unknown[];
}

function fakeClient(overrides: Partial<FakeWalrusClient> = {}): {
	client: FakeWalrusClient;
	calls: CallLog;
} {
	const calls: CallLog = { writeBlob: [], writeQuilt: [] };
	const client: FakeWalrusClient = {
		writeBlob: async (args) => {
			calls.writeBlob.push(args);
			return {
				blobId: SAMPLE_BLOB_ID,
				blobObject: { id: SUI_OBJECT_ID },
			};
		},
		writeQuilt: async (args) => {
			calls.writeQuilt.push(args);
			return {
				blobId: SAMPLE_BLOB_ID,
				blobObject: { id: SUI_OBJECT_ID },
				index: {
					patches: [
						{
							patchId: quiltPatchIdToString(
								encodeQuiltPatchId({
									quiltBlobId: SAMPLE_BLOB_ID,
									version: QUILT_PATCH_ID_VERSION,
									startIndex: 1,
									endIndex: 2,
								}),
							),
							startIndex: 1,
							endIndex: 2,
							identifier: "first",
						},
					],
				},
			};
		},
		writeBlobFlow: () => {
			throw new Error(
				"writeBlobFlow not implemented in this fake; tests that exercise startBlobUpload supply their own override",
			);
		},
		...overrides,
	};
	return { client, calls };
}

describe("DefaultWalrusWriteAdapter.uploadBlob", () => {
	test("forwards options and brands the result", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});
		const data = new Uint8Array([1, 2, 3]);
		const signal = new AbortController().signal;

		const result = await adapter.uploadBlob(data, {
			epochs: 3,
			deletable: true,
			owner: "0xabc",
			signal,
		});

		expect(result.blobId).toBe(SAMPLE_BLOB_ID);
		expect(result.blobObjectId as string).toBe(SUI_OBJECT_ID);
		expect(calls.writeBlob).toHaveLength(1);
		const passed = calls.writeBlob[0] as Record<string, unknown>;
		expect(passed.blob).toBe(data);
		expect(passed.epochs).toBe(3);
		expect(passed.deletable).toBe(true);
		expect(passed.owner).toBe("0xabc");
		expect(passed.signal).toBe(signal);
		expect(passed.signer).toBe(FAKE_SIGNER);
	});

	test("omits owner and signal when not supplied", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		await adapter.uploadBlob(new Uint8Array([0]), {
			epochs: 1,
			deletable: false,
		});

		const passed = calls.writeBlob[0] as Record<string, unknown>;
		expect("owner" in passed).toBe(false);
		expect("signal" in passed).toBe(false);
	});

	test("wraps non-Morse errors as TransportError and preserves cause", async () => {
		const original = new Error("network down");
		const { client } = fakeClient({
			writeBlob: async () => {
				throw original;
			},
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		let caught: unknown;
		try {
			await adapter.uploadBlob(new Uint8Array(), {
				epochs: 1,
				deletable: true,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TransportError);
		expect((caught as TransportError & { cause: unknown }).cause).toBe(
			original,
		);
	});

	test("preserves a NotEnoughBlobConfirmationsError cause for instanceof narrowing", async () => {
		const original = new NotEnoughBlobConfirmationsError(
			"Too many failures while writing blob X to nodes",
		);
		const { client } = fakeClient({
			writeBlob: async () => {
				throw original;
			},
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		let caught: unknown;
		try {
			await adapter.uploadBlob(new Uint8Array(), {
				epochs: 1,
				deletable: true,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TransportError);
		const cause = (caught as TransportError & { cause: unknown }).cause;
		expect(cause).toBe(original);
		expect(cause).toBeInstanceOf(NotEnoughBlobConfirmationsError);
	});

	test("propagates ValidationError without wrapping", async () => {
		const ve = new ValidationError("nope", "blob");
		const { client } = fakeClient({
			writeBlob: async () => {
				throw ve;
			},
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		await expect(
			adapter.uploadBlob(new Uint8Array(), { epochs: 1, deletable: true }),
		).rejects.toBe(ve);
	});

	test("maps UserAbortError to TransportError with a recognizable message", async () => {
		const original = new UserAbortError({ message: "aborted" });
		const { client } = fakeClient({
			writeBlob: async () => {
				throw original;
			},
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		let caught: unknown;
		try {
			await adapter.uploadBlob(new Uint8Array(), {
				epochs: 1,
				deletable: true,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TransportError);
		expect((caught as Error).message).toContain("aborted by caller");
		expect((caught as TransportError & { cause: unknown }).cause).toBe(
			original,
		);
	});

	test("rejects bad blobId from the server with ValidationError", async () => {
		const { client } = fakeClient({
			writeBlob: async () => ({
				blobId: "not-a-valid-base64-id!!",
				blobObject: { id: SUI_OBJECT_ID },
			}),
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		await expect(
			adapter.uploadBlob(new Uint8Array(), { epochs: 1, deletable: true }),
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe("DefaultWalrusWriteAdapter.startBlobUpload", () => {
	test("threads the register tx digest into flow.upload (regression: addEntryFromBytes broke without this)", async () => {
		const REGISTER_DIGEST = "register-digest-abc";
		const FLOW_BLOB_ID = SAMPLE_BLOB_ID;
		const FLOW_OBJECT_ID = SUI_OBJECT_ID;
		const certifyTx = new (
			await import("@mysten/sui/transactions")
		).Transaction();

		const calls: { register: unknown[]; upload: unknown[]; certify: number } = {
			register: [],
			upload: [],
			certify: 0,
		};

		const fakeFlow = {
			encode: async () => ({}) as never,
			executeRegister: async (args: unknown) => {
				calls.register.push(args);
				return {
					step: "registered" as const,
					blobId: FLOW_BLOB_ID,
					blobObjectId: FLOW_OBJECT_ID,
					txDigest: REGISTER_DIGEST,
				};
			},
			upload: async (args: unknown) => {
				calls.upload.push(args);
				return {} as never;
			},
			certify: () => {
				calls.certify += 1;
				return certifyTx;
			},
			register: () => certifyTx,
			executeCertify: async () => ({}) as never,
			getBlob: async () => ({}) as never,
			run: async function* () {},
		};

		const { client } = fakeClient({
			writeBlobFlow: (() => fakeFlow) as unknown as ReturnType<
				typeof fakeClient
			>["client"]["writeBlobFlow"],
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		const result = await adapter.startBlobUpload(new Uint8Array([1]), {
			epochs: 3,
			deletable: true,
			// FAKE_SIGNER has no toSuiAddress; pass owner explicitly so the
			// adapter doesn't fall back to it.
			owner: SUI_OBJECT_ID,
		});

		expect(calls.register).toHaveLength(1);
		expect(calls.upload).toHaveLength(1);
		expect((calls.upload[0] as { digest?: string }).digest).toBe(
			REGISTER_DIGEST,
		);
		expect(calls.certify).toBe(1);
		expect(result.blobObjectId as unknown as string).toBe(FLOW_OBJECT_ID);
		expect(result.blobId as unknown as string).toBe(FLOW_BLOB_ID);
		expect(result.certifyTransaction).toBe(certifyTx);
	});
});

describe("DefaultWalrusWriteAdapter.uploadQuilt", () => {
	test("forwards patches and decodes the patch id", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});
		const result = await adapter.uploadQuilt(
			[
				{
					contents: new Uint8Array([1]),
					identifier: "first",
					tags: { mime: "text/plain" },
				},
			],
			{ epochs: 2, deletable: true },
		);

		expect(result.patches).toHaveLength(1);
		const patch = result.patches[0];
		expect(patch).toBeDefined();
		expect(patch?.patchId.length).toBe(QUILT_PATCH_ID_LENGTH);
		expect(patch?.startIndex).toBe(1);
		expect(patch?.endIndex).toBe(2);
		expect(patch?.identifier).toBe("first");

		const passed = calls.writeQuilt[0] as Record<string, unknown>;
		const blobs = passed.blobs as Array<Record<string, unknown>>;
		expect(blobs).toHaveLength(1);
		expect(blobs[0]?.identifier).toBe("first");
		expect(blobs[0]?.tags).toEqual({ mime: "text/plain" });
	});

	test("forwards signal and owner when supplied", async () => {
		const { client, calls } = fakeClient();
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});
		const signal = new AbortController().signal;

		await adapter.uploadQuilt(
			[{ contents: new Uint8Array([1]), identifier: "first" }],
			{ epochs: 2, deletable: true, owner: "0xabc", signal },
		);

		const passed = calls.writeQuilt[0] as Record<string, unknown>;
		expect(passed.owner).toBe("0xabc");
		expect(passed.signal).toBe(signal);
	});

	test("rejects empty patch list with ValidationError", async () => {
		const { client } = fakeClient();
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		await expect(
			adapter.uploadQuilt([], { epochs: 1, deletable: true }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("wraps writeQuilt failures as TransportError", async () => {
		const { client } = fakeClient({
			writeQuilt: async () => {
				throw new Error("rate-limited");
			},
		});
		const adapter = new DefaultWalrusWriteAdapter({
			client,
			signer: FAKE_SIGNER,
		});

		await expect(
			adapter.uploadQuilt([{ contents: new Uint8Array(), identifier: "x" }], {
				epochs: 1,
				deletable: true,
			}),
		).rejects.toBeInstanceOf(TransportError);
	});
});
