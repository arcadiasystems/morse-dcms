import { describe, expect, test } from "bun:test";

import { resolveContentType } from "../src/cli/input.ts";

describe("resolveContentType", () => {
	test("an explicit type wins over inference", () => {
		expect(resolveContentType("text/custom", "image.png")).toBe("text/custom");
	});

	test("infers from the file extension", () => {
		expect(resolveContentType(undefined, "photo.PNG")).toBe("image/png");
		expect(resolveContentType(undefined, "notes.md")).toBe("text/markdown");
		expect(resolveContentType(undefined, "data.json")).toBe("application/json");
	});

	test("falls back to octet-stream for unknown, missing, or stdin sources", () => {
		expect(resolveContentType(undefined, "archive.bin")).toBe(
			"application/octet-stream",
		);
		expect(resolveContentType(undefined, undefined)).toBe(
			"application/octet-stream",
		);
		expect(resolveContentType(undefined, "-")).toBe("application/octet-stream");
	});
});
