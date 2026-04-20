import { describe, expect, test } from "bun:test";

import * as morseSdk from "../src/index";

describe("morse-sdk", () => {
	test("module loads", () => {
		expect(morseSdk).toBeDefined();
	});
});
