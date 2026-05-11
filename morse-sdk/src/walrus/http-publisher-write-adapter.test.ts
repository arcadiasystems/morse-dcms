import { describe, expect, mock, test } from "bun:test";

import { toSuiAddress } from "../codecs.js";
import { TransportError, ValidationError } from "../errors.js";
import {
	HttpPublisherWriteAdapter,
	type HttpPublisherWriteAdapterOptions,
	type ParsePublisherResponse,
} from "./http-publisher-write-adapter.js";

type FetchOption = NonNullable<HttpPublisherWriteAdapterOptions["fetch"]>;

const OWNER = toSuiAddress(
	"0x0000000000000000000000000000000000000000000000000000000000000111",
);
const BLOB_OBJECT_ID =
	"0x0000000000000000000000000000000000000000000000000000000000000abc";
const SAMPLE_BLOB_ID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function jsonResponse(body: unknown): {
	ok: true;
	status: 200;
	statusText: "OK";
	json: () => Promise<unknown>;
	text: () => Promise<string>;
} {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

describe("HttpPublisherWriteAdapter.uploadBlob", () => {
	test("PUTs to /v1/blobs with epochs and send_object_to query params", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				newlyCreated: {
					blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1, 2, 3]), {
			epochs: 3,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(result.blobId as string).toBe(SAMPLE_BLOB_ID);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const call = (
			fetchMock.mock.calls as unknown as Array<
				[string, { method?: string; body?: unknown }]
			>
		)[0];
		const url = call?.[0] ?? "";
		expect(url).toContain("https://pub.test/v1/blobs");
		expect(url).toContain("epochs=3");
		expect(url).toContain(`send_object_to=${encodeURIComponent(OWNER)}`);
		expect(url).not.toContain("permanent=");
		expect(call?.[1]?.method).toBe("PUT");
	});

	test("parses alreadyCertified with object id", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				alreadyCertified: {
					blob_id: SAMPLE_BLOB_ID,
					object: BLOB_OBJECT_ID,
					end_epoch: 100,
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(result.blobId as string).toBe(SAMPLE_BLOB_ID);
	});

	test("alreadyCertified without object id surfaces TransportError with hint", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				alreadyCertified: {
					blob_id: SAMPLE_BLOB_ID,
					event: { txDigest: [1, 2, 3], eventSeq: "0" },
					end_epoch: 100,
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.uploadBlob(new Uint8Array([1]), {
				epochs: 1,
				deletable: true,
			}),
		).rejects.toThrow(TransportError);
	});

	test("markedInvalid surfaces TransportError", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				markedInvalid: {
					blob_id: SAMPLE_BLOB_ID,
					event: { txDigest: [], eventSeq: "0" },
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.uploadBlob(new Uint8Array([1]), { epochs: 1, deletable: true }),
		).rejects.toThrow(TransportError);
	});

	test("rejects empty bytes with ValidationError before any IO", async () => {
		const fetchMock = mock(async () => jsonResponse({}));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.uploadBlob(new Uint8Array(), { epochs: 1, deletable: true }),
		).rejects.toBeInstanceOf(ValidationError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("rejects non-positive epochs with ValidationError", async () => {
		const fetchMock = mock(async () => jsonResponse({}));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.uploadBlob(new Uint8Array([1]), { epochs: 0, deletable: true }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("sends permanent=true when deletable: false", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				newlyCreated: {
					blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: false,
		});
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0] as string).toContain("permanent=true");
	});

	test("respects per-call owner override over constructor ownerAddress", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				newlyCreated: {
					blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const otherOwner = toSuiAddress(
			"0x0000000000000000000000000000000000000000000000000000000000000222",
		);
		await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
			owner: otherOwner,
		});
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0] as string).toContain(
			`send_object_to=${encodeURIComponent(otherOwner)}`,
		);
	});
});

describe("HttpPublisherWriteAdapter live response shape", () => {
	test("parses the exact camelCase JSON the live publisher returns (regression fixture from nami.cloud 2026-05-11)", async () => {
		// Captured verbatim from `curl -X PUT $PUBLISHER/v1/blobs ...` against
		// walrus-testnet-publisher.nami.cloud. The OpenAPI spec at
		// $PUBLISHER/v1/api documents snake_case but live services serve
		// camelCase; this fixture pins the adapter against the wire format.
		const fixture = {
			newlyCreated: {
				blobObject: {
					id: "0xe62f27e92f49b33697f397791ba7a1c0fafeb7cabfb7a41a7c64e6082433462e",
					registeredEpoch: 394,
					blobId: "bXniETRLCkhkI97OnVT1wHz_T-BSaKNQdEAAyG7KsrE",
					size: 17,
					encodingType: "RS2",
					certifiedEpoch: null,
					storage: {
						id: "0xe0ba06b8c125dce703e29eecda47a242217bd07bad4b0dfed51c3534d2713345",
						startEpoch: 394,
						endEpoch: 395,
						storageSize: 66034000,
					},
					deletable: true,
				},
				resourceOperation: {
					registerFromScratch: { encodedLength: 66034000, epochsAhead: 1 },
				},
				cost: 223776,
			},
		};
		const fetchMock = mock(async () => jsonResponse(fixture));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(
			"0xe62f27e92f49b33697f397791ba7a1c0fafeb7cabfb7a41a7c64e6082433462e",
		);
		expect(result.blobId as string).toBe(
			"bXniETRLCkhkI97OnVT1wHz_T-BSaKNQdEAAyG7KsrE",
		);
	});

	test("accepts snake_case fallback (blob_object.blob_id) in case a publisher serves the documented schema", async () => {
		const fixture = {
			newlyCreated: {
				blob_object: { id: BLOB_OBJECT_ID, blob_id: SAMPLE_BLOB_ID },
			},
		};
		const fetchMock = mock(async () => jsonResponse(fixture));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(result.blobId as string).toBe(SAMPLE_BLOB_ID);
	});
});

describe("HttpPublisherWriteAdapter default fetch binding", () => {
	test("default `fetch` is bound to globalThis (browser TypeError: Illegal invocation regression)", async () => {
		// Browsers enforce `window.fetch` is called with `window` as its
		// receiver; storing `globalThis.fetch` on the adapter and calling it
		// as `this.#fetch(...)` invokes it with the adapter as `this` and
		// browsers throw `TypeError: Illegal invocation`. Node is permissive
		// so a naive `options.fetch ?? globalThis.fetch` passes CLI tests
		// and breaks in browsers. Simulate the browser check: install a
		// global `fetch` that only succeeds when called with `globalThis`
		// (or an explicit `undefined`/`globalThis`) as the receiver.
		const originalFetch = globalThis.fetch;
		const sentinel = {
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => "",
			json: async () => ({
				newlyCreated: {
					blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
				},
			}),
		};
		const strictFetch = function strictFetch(
			this: unknown,
			_input: string,
			_init?: unknown,
		): Promise<typeof sentinel> {
			// Mirror the browser HostObject receiver check: bare-method calls
			// have `this` === undefined (strict mode) or globalThis (sloppy).
			// Calling via an instance field gives `this` === the instance.
			if (this !== undefined && this !== globalThis) {
				return Promise.reject(
					new TypeError(
						"Failed to execute 'fetch' on 'Window': Illegal invocation",
					),
				);
			}
			return Promise.resolve(sentinel);
		};
		(globalThis as unknown as { fetch: unknown }).fetch =
			strictFetch as unknown;

		try {
			const adapter = new HttpPublisherWriteAdapter({
				publisherUrl: "https://pub.test",
				ownerAddress: OWNER,
				// no `fetch` option — exercise the default-path branch
			});
			// Will throw `TransportError: ... Illegal invocation` if the bug
			// regresses; resolves with the parsed result if the fetch is bound.
			const result = await adapter.uploadBlob(new Uint8Array([1]), {
				epochs: 1,
				deletable: true,
			});
			expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		} finally {
			(globalThis as unknown as { fetch: typeof originalFetch }).fetch =
				originalFetch;
		}
	});
});

describe("HttpPublisherWriteAdapter custom parseResponse escape hatch", () => {
	test("calls parseResponse with the raw decoded JSON instead of the built-in parser", async () => {
		const customShape = { my: "publisher", uses: "different-fields" };
		const fetchMock = mock(async () => jsonResponse(customShape));
		const customParser = mock(async () => ({
			blobObjectId: BLOB_OBJECT_ID,
			blobId: SAMPLE_BLOB_ID,
		}));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
			parseResponse: customParser as unknown as ParsePublisherResponse,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(customParser).toHaveBeenCalledTimes(1);
		const args = (customParser.mock.calls as unknown as Array<[unknown]>)[0];
		expect(args?.[0]).toEqual(customShape);
	});

	test("parseResponse throws propagate verbatim (consumer typed errors pass through)", async () => {
		const fetchMock = mock(async () => jsonResponse({ anything: "x" }));
		const consumerError = new ValidationError(
			"custom publisher returned unrecognized shape",
			"custom",
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
			parseResponse: () => {
				throw consumerError;
			},
		});
		await expect(
			adapter.uploadBlob(new Uint8Array([1]), { epochs: 1, deletable: true }),
		).rejects.toBe(consumerError);
	});

	test("built-in parser still runs when parseResponse is undefined", async () => {
		const fetchMock = mock(async () =>
			jsonResponse({
				newlyCreated: {
					blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
				},
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		const result = await adapter.uploadBlob(new Uint8Array([1]), {
			epochs: 1,
			deletable: true,
		});
		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(result.blobId as string).toBe(SAMPLE_BLOB_ID);
	});
});

describe("HttpPublisherWriteAdapter.uploadQuilt", () => {
	test("rejects empty patches with ValidationError", async () => {
		const fetchMock = mock(async () => jsonResponse({}));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.uploadQuilt([], { epochs: 1, deletable: true }),
		).rejects.toBeInstanceOf(ValidationError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("parses a quilt response with blobStoreResult + storedQuiltBlobs", async () => {
		// QuiltPatchId structural encoding: blobId (32 bytes) || version (1) ||
		// startIndex (u16 LE, 2 bytes) || endIndex (u16 LE, 2 bytes) = 37 bytes
		// total. The decoder in `decodeStartEndFromPatchId` reads startIndex/endIndex
		// from the patch-id bytes, not from a separate `range` field.
		const { encodeQuiltPatchId, quiltPatchIdToString } = await import(
			"./quilt-patch-id.js"
		);
		const patchId = quiltPatchIdToString(
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID as never,
				version: 1,
				startIndex: 5,
				endIndex: 9,
			}),
		);

		const fetchMock = mock(async () =>
			jsonResponse({
				blobStoreResult: {
					newlyCreated: {
						blobObject: { id: BLOB_OBJECT_ID, blobId: SAMPLE_BLOB_ID },
					},
				},
				storedQuiltBlobs: [{ identifier: "first", quiltPatchId: patchId }],
			}),
		);
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
		});

		const result = await adapter.uploadQuilt(
			[
				{
					contents: new Uint8Array([1, 2, 3]),
					identifier: "first",
				},
			],
			{ epochs: 1, deletable: true },
		);

		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(result.blobId as string).toBe(SAMPLE_BLOB_ID);
		expect(result.patches).toHaveLength(1);
		expect(result.patches[0]?.identifier).toBe("first");
		expect(result.patches[0]?.startIndex).toBe(5);
		expect(result.patches[0]?.endIndex).toBe(9);
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0] as string).toContain("/v1/quilts");
	});

	test("routes the inner blobStoreResult through parseResponse when set", async () => {
		const { encodeQuiltPatchId, quiltPatchIdToString } = await import(
			"./quilt-patch-id.js"
		);
		const patchId = quiltPatchIdToString(
			encodeQuiltPatchId({
				quiltBlobId: SAMPLE_BLOB_ID as never,
				version: 1,
				startIndex: 0,
				endIndex: 4,
			}),
		);
		const fetchMock = mock(async () =>
			jsonResponse({
				blobStoreResult: { exoticShape: true },
				storedQuiltBlobs: [{ identifier: "p", quiltPatchId: patchId }],
			}),
		);
		const customParser = mock(async () => ({
			blobObjectId: BLOB_OBJECT_ID,
			blobId: SAMPLE_BLOB_ID,
		}));
		const adapter = new HttpPublisherWriteAdapter({
			publisherUrl: "https://pub.test",
			ownerAddress: OWNER,
			fetch: fetchMock as unknown as FetchOption,
			parseResponse: customParser as unknown as ParsePublisherResponse,
		});

		const result = await adapter.uploadQuilt(
			[{ contents: new Uint8Array([1]), identifier: "p" }],
			{ epochs: 1, deletable: true },
		);

		expect(result.blobObjectId as string).toBe(BLOB_OBJECT_ID);
		expect(customParser).toHaveBeenCalledTimes(1);
		const args = (customParser.mock.calls as unknown as Array<[unknown]>)[0];
		expect(args?.[0]).toEqual({ exoticShape: true });
	});
});
