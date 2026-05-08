import { describe, expect, test } from "bun:test";
import { bcs } from "@mysten/sui/bcs";

import { TransportError } from "../errors.js";
import type { SimulationReturnValues } from "../wallets/adapter.js";
import { decodeU64ReturnValue } from "./internal.js";

const SAFE_MAX_AS_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function bcsU64(value: number | bigint): Uint8Array {
	return bcs.u64().serialize(value).toBytes();
}

describe("decodeU64ReturnValue", () => {
	test("decodes Number.MAX_SAFE_INTEGER", () => {
		const sim: SimulationReturnValues = [[bcsU64(SAFE_MAX_AS_BIGINT)]];
		expect(decodeU64ReturnValue(sim, 0, 0)).toBe(Number.MAX_SAFE_INTEGER);
	});

	test("rejects values exceeding Number.MAX_SAFE_INTEGER", () => {
		const sim: SimulationReturnValues = [[bcsU64(SAFE_MAX_AS_BIGINT + 1n)]];
		expect(() => decodeU64ReturnValue(sim, 0, 0)).toThrow(TransportError);
	});

	test("throws when the requested command index is missing", () => {
		expect(() => decodeU64ReturnValue([], 0, 0)).toThrow(TransportError);
	});

	test("throws when the requested return-value index is missing", () => {
		const sim: SimulationReturnValues = [[]];
		expect(() => decodeU64ReturnValue(sim, 0, 0)).toThrow(TransportError);
	});
});
