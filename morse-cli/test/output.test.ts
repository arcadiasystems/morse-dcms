import { afterEach, describe, expect, test } from "bun:test";

import { resolveColor } from "../src/cli/output.ts";
import { toJson } from "../src/format/json.ts";

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

describe("resolveColor", () => {
	const savedNoColor = process.env.NO_COLOR;
	const savedForceColor = process.env.FORCE_COLOR;

	afterEach(() => {
		restoreEnv("NO_COLOR", savedNoColor);
		restoreEnv("FORCE_COLOR", savedForceColor);
	});

	test("JSON mode never enables color", () => {
		process.env.FORCE_COLOR = "1";
		expect(resolveColor(true)).toBe(false);
	});

	test("a non-empty NO_COLOR disables color", () => {
		process.env.NO_COLOR = "1";
		delete process.env.FORCE_COLOR;
		expect(resolveColor(false)).toBe(false);
	});

	test("a non-empty FORCE_COLOR enables color without a TTY", () => {
		delete process.env.NO_COLOR;
		process.env.FORCE_COLOR = "1";
		expect(resolveColor(false)).toBe(true);
	});
});

describe("toJson", () => {
	test("encodes bigint as a decimal string", () => {
		expect(toJson({ gasUsedMist: 1234n })).toBe(
			'{\n  "gasUsedMist": "1234"\n}',
		);
	});

	test("encodes Uint8Array as a 0x-hex string", () => {
		expect(toJson({ sealId: new Uint8Array([0, 255, 16]) })).toBe(
			'{\n  "sealId": "0x00ff10"\n}',
		);
	});
});
