import { describe, expect, mock, test } from "bun:test";

import type { ObjectReader } from "../clients.js";
import { toBlobObjectId, toQuiltPatchId, toWalrusBlobId } from "../codecs.js";
import {
	ConfigurationError,
	NotFoundError,
	TransportError,
} from "../errors.js";
import { QUILT_PATCH_ID_LENGTH } from "../types.js";
import {
	HttpAggregatorReadAdapter,
	type HttpAggregatorReadAdapterOptions,
} from "./http-aggregator-read-adapter.js";

type FetchOption = NonNullable<HttpAggregatorReadAdapterOptions["fetch"]>;

const SAMPLE_BLOB_ID = toWalrusBlobId(
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
);
const SUI_OBJECT_ID = toBlobObjectId(
	"0xd1dd47c84e7c2f217a8b5a4fcec849a3b985df4fada82f72b72602423d8d018e",
);
const PATCH_ID = toQuiltPatchId(new Uint8Array(QUILT_PATCH_ID_LENGTH).fill(7));

function okResponse(bytes: Uint8Array): {
	ok: true;
	status: 200;
	statusText: "OK";
	arrayBuffer: () => Promise<ArrayBuffer>;
} {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
	};
}

function fakeSuiClient(): ObjectReader {
	return {
		getObject: mock(async () => ({})) as unknown as ObjectReader["getObject"],
		listOwnedObjects: mock(
			async () => ({}),
		) as unknown as ObjectReader["listOwnedObjects"],
		listDynamicFields: mock(
			async () => ({}),
		) as unknown as ObjectReader["listDynamicFields"],
		getDynamicField: mock(
			async () => ({}),
		) as unknown as ObjectReader["getDynamicField"],
	};
}

describe("HttpAggregatorReadAdapter.readBlob", () => {
	test("GETs the aggregator URL and returns the response body as Uint8Array", async () => {
		const fetchMock = mock(async () =>
			okResponse(new Uint8Array([0xde, 0xad])),
		);
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test/",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		const bytes = await adapter.readBlob(SAMPLE_BLOB_ID);
		expect(Array.from(bytes)).toEqual([0xde, 0xad]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0]).toBe(`https://agg.test/v1/blobs/${SAMPLE_BLOB_ID}`);
	});

	test("strips trailing slash from aggregatorUrl", async () => {
		const fetchMock = mock(async () => okResponse(new Uint8Array([1])));
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test///",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		await adapter.readBlob(SAMPLE_BLOB_ID);
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0]).toBe(`https://agg.test/v1/blobs/${SAMPLE_BLOB_ID}`);
	});

	test("maps HTTP 404 to NotFoundError with resource 'blob'", async () => {
		const fetchMock = mock(async () => ({
			ok: false,
			status: 404,
			statusText: "Not Found",
			arrayBuffer: async () => new ArrayBuffer(0),
		}));
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		let caught: unknown;
		try {
			await adapter.readBlob(SAMPLE_BLOB_ID);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(NotFoundError);
		expect((caught as NotFoundError).resource).toBe("blob");
	});

	test("maps other HTTP errors to TransportError", async () => {
		const fetchMock = mock(async () => ({
			ok: false,
			status: 502,
			statusText: "Bad Gateway",
			arrayBuffer: async () => new ArrayBuffer(0),
		}));
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(adapter.readBlob(SAMPLE_BLOB_ID)).rejects.toBeInstanceOf(
			TransportError,
		);
	});

	test("wraps fetch throws as TransportError preserving cause", async () => {
		const original = new Error("network unreachable");
		const fetchMock = mock(async () => {
			throw original;
		});
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		let caught: unknown;
		try {
			await adapter.readBlob(SAMPLE_BLOB_ID);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(TransportError);
		expect((caught as TransportError & { cause: unknown }).cause).toBe(
			original,
		);
	});

	test("invokes verifyBlobIntegrity callback with bytes and blobId", async () => {
		const fetchMock = mock(async () => okResponse(new Uint8Array([0xfa])));
		const verify = mock(async () => undefined);
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
			verifyBlobIntegrity: verify,
		});
		await adapter.readBlob(SAMPLE_BLOB_ID);
		expect(verify).toHaveBeenCalledTimes(1);
		const args = (
			verify.mock.calls as unknown as Array<[Uint8Array, string]>
		)[0];
		expect(args?.[1]).toBe(SAMPLE_BLOB_ID);
	});

	test("rewraps verifyBlobIntegrity failure as TransportError", async () => {
		const fetchMock = mock(async () => okResponse(new Uint8Array([0xfa])));
		const verifyError = new Error("hash mismatch");
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
			verifyBlobIntegrity: async () => {
				throw verifyError;
			},
		});
		let caught: unknown;
		try {
			await adapter.readBlob(SAMPLE_BLOB_ID);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(TransportError);
		expect((caught as TransportError & { cause: unknown }).cause).toBe(
			verifyError,
		);
	});
});

describe("HttpAggregatorReadAdapter default fetch binding", () => {
	test("default `fetch` is bound to globalThis (browser TypeError: Illegal invocation regression)", async () => {
		// See the matching test in http-publisher-write-adapter.test.ts for
		// the full rationale; browsers enforce `window.fetch`'s receiver and
		// throw `Illegal invocation` if the adapter stores globalThis.fetch
		// as a field and calls it as a method.
		const originalFetch = globalThis.fetch;
		const sentinelBytes = new Uint8Array([0xab, 0xcd]);
		const strictFetch = function strictFetch(
			this: unknown,
			_input: string,
			_init?: unknown,
		): Promise<{
			ok: boolean;
			status: number;
			statusText: string;
			arrayBuffer: () => Promise<ArrayBuffer>;
		}> {
			if (this !== undefined && this !== globalThis) {
				return Promise.reject(
					new TypeError(
						"Failed to execute 'fetch' on 'Window': Illegal invocation",
					),
				);
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				arrayBuffer: async () => sentinelBytes.buffer.slice(0) as ArrayBuffer,
			});
		};
		(globalThis as unknown as { fetch: unknown }).fetch =
			strictFetch as unknown;

		try {
			const adapter = new HttpAggregatorReadAdapter({
				aggregatorUrl: "https://agg.test",
				suiClient: fakeSuiClient(),
				// no `fetch` option — exercise the default-path branch
			});
			const bytes = await adapter.readBlob(SAMPLE_BLOB_ID);
			expect(Array.from(bytes)).toEqual([0xab, 0xcd]);
		} finally {
			(globalThis as unknown as { fetch: typeof originalFetch }).fetch =
				originalFetch;
		}
	});
});

describe("HttpAggregatorReadAdapter.readQuiltPatch", () => {
	test("GETs the by-quilt-patch-id endpoint", async () => {
		const fetchMock = mock(async () =>
			okResponse(new Uint8Array([0xfe, 0xed])),
		);
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient: fakeSuiClient(),
			fetch: fetchMock as unknown as FetchOption,
		});
		const out = await adapter.readQuiltPatch(PATCH_ID);
		expect(Array.from(out)).toEqual([0xfe, 0xed]);
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0]).toContain("/v1/blobs/by-quilt-patch-id/");
	});
});

describe("HttpAggregatorReadAdapter.readBlobByObjectId", () => {
	test("resolves blob_id from Sui object and fetches the aggregator", async () => {
		const suiClient = {
			getObject: mock(async () => ({
				object: { objectId: SUI_OBJECT_ID, json: { blob_id: "42" } },
			})),
			listOwnedObjects: mock(async () => ({})),
			listDynamicFields: mock(async () => ({})),
			getDynamicField: mock(async () => ({})),
		} as unknown as ObjectReader;
		const fetchMock = mock(async () =>
			okResponse(new Uint8Array([0xde, 0xad])),
		);
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient,
			fetch: fetchMock as unknown as FetchOption,
		});
		await adapter.readBlobByObjectId(SUI_OBJECT_ID);
		expect(suiClient.getObject).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// The fetch URL is `/v1/blobs/${blobIdFromInt(42n)}`; we can't easily
		// reproduce the base64 form here, but the URL should be well-formed.
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0]).toMatch(/\/v1\/blobs\/[A-Za-z0-9_-]+$/);
	});

	test("throws NotFoundError when the Sui object is missing", async () => {
		const suiClient = {
			getObject: mock(async () => ({ object: undefined })),
			listOwnedObjects: mock(async () => ({})),
			listDynamicFields: mock(async () => ({})),
			getDynamicField: mock(async () => ({})),
		} as unknown as ObjectReader;
		const fetchMock = mock(async () => okResponse(new Uint8Array([])));
		const adapter = new HttpAggregatorReadAdapter({
			aggregatorUrl: "https://agg.test",
			suiClient,
			fetch: fetchMock as unknown as FetchOption,
		});
		await expect(
			adapter.readBlobByObjectId(SUI_OBJECT_ID),
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("HttpAggregatorReadAdapter.fromMorseConfig", () => {
	test("uses morseConfig.walrusEndpoints.aggregator", async () => {
		const fetchMock = mock(async () => okResponse(new Uint8Array([1])));
		const adapter = HttpAggregatorReadAdapter.fromMorseConfig(
			{
				walrusEndpoints: {
					aggregator: "https://agg.from-config.test",
				},
			},
			fakeSuiClient(),
			{
				fetch: fetchMock as unknown as FetchOption,
			},
		);
		await adapter.readBlob(SAMPLE_BLOB_ID);
		const call = (
			fetchMock.mock.calls as unknown as Array<[string, unknown]>
		)[0];
		expect(call?.[0]).toContain("https://agg.from-config.test/v1/blobs/");
	});

	test("throws ConfigurationError when walrusEndpoints.aggregator is empty", () => {
		expect(() =>
			HttpAggregatorReadAdapter.fromMorseConfig(
				{ walrusEndpoints: { aggregator: "" } },
				fakeSuiClient(),
			),
		).toThrow(ConfigurationError);
	});
});
