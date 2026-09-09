import { afterEach, describe, expect, test } from "bun:test";

import { Output, resolveColor } from "../src/cli/output.ts";
import { toJson } from "../src/format/json.ts";

function sinks() {
	let out = "";
	let err = "";
	return {
		writeOut: (t: string) => {
			out += t;
		},
		writeErr: (t: string) => {
			err += t;
		},
		out: () => out,
		err: () => err,
	};
}

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

describe("Output", () => {
	test("result goes to stdout; info and warn go to stderr", () => {
		const s = sinks();
		const output = new Output({
			json: false,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		output.result("the result", { ok: true });
		output.info("progress");
		output.warn("careful");
		expect(s.out()).toBe("the result\n");
		expect(s.err()).toContain("progress");
		expect(s.err()).toContain("careful");
	});

	test("color wraps info and warn in ANSI codes", () => {
		const s = sinks();
		const output = new Output({
			json: false,
			quiet: false,
			color: true,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		output.info("dim");
		output.warn("yellow");
		expect(s.err()).toContain("\x1b[2mdim\x1b[0m");
		expect(s.err()).toContain("\x1b[33myellow\x1b[0m");
	});

	test("quiet suppresses info and warn but not the result", () => {
		const s = sinks();
		const output = new Output({
			json: false,
			quiet: true,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		output.result("still shown", {});
		output.info("hidden");
		output.warn("hidden");
		expect(s.out()).toBe("still shown\n");
		expect(s.err()).toBe("");
	});

	test("without injected sinks, result falls through to process.stdout", () => {
		let written = "";
		const original = process.stdout.write.bind(process.stdout);
		(process.stdout as { write: unknown }).write = (text: string): boolean => {
			written += text;
			return true;
		};
		try {
			new Output({ json: false, quiet: false, color: false }).result(
				"prod",
				{},
			);
		} finally {
			(process.stdout as { write: unknown }).write = original;
		}
		expect(written).toBe("prod\n");
	});

	test("json mode emits the structured value and suppresses diagnostics", () => {
		const s = sinks();
		const output = new Output({
			json: true,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		output.result("ignored human text", { value: 1 });
		output.info("hidden");
		expect(JSON.parse(s.out())).toEqual({ value: 1 });
		expect(s.err()).toBe("");
		expect(output.isJson).toBe(true);
	});
});

describe("Output.withNetwork", () => {
	test("inserts the network under the headline, above the detail lines", () => {
		const s = sinks();
		const base = new Output({
			json: false,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		base
			.withNetwork("mainnet")
			.result(
				['Created "My Pub" (0xabc)', "  ownerCap:     0xdef", "Selected."].join(
					"\n",
				),
				{},
			);
		expect(s.out()).toBe(
			[
				'Created "My Pub" (0xabc)',
				"  network:      mainnet",
				"  ownerCap:     0xdef",
				"Selected.",
				"",
			].join("\n"),
		);
	});

	test("appends the network when the result is a single line", () => {
		const s = sinks();
		const out = new Output({
			json: false,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		}).withNetwork("testnet");
		out.result("Deleted 0xabc", {});
		expect(s.out()).toBe("Deleted 0xabc\n  network:      testnet\n");
	});

	test("adds a network key to a JSON object result", () => {
		const s = sinks();
		const out = new Output({
			json: true,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		}).withNetwork("mainnet");
		out.result("human", { publicationId: "0xabc" });
		expect(JSON.parse(s.out())).toEqual({
			network: "mainnet",
			publicationId: "0xabc",
		});
	});

	test("does not overwrite a network key the command already set", () => {
		const s = sinks();
		const out = new Output({
			json: true,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		}).withNetwork("mainnet");
		out.result("human", { network: "testnet" });
		expect(JSON.parse(s.out())).toEqual({ network: "testnet" });
	});

	test("leaves non-object JSON payloads untouched", () => {
		// Arrays and primitives would change shape if the network were merged in,
		// breaking any consumer that indexes the result.
		const s = sinks();
		const out = new Output({
			json: true,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		}).withNetwork("mainnet");
		out.result("human", [1, 2]);
		expect(JSON.parse(s.out())).toEqual([1, 2]);
	});

	test("an Output without a network is unchanged", () => {
		// Read and list commands must render exactly as before.
		const s = sinks();
		const out = new Output({
			json: false,
			quiet: false,
			color: false,
			writeOut: s.writeOut,
			writeErr: s.writeErr,
		});
		out.result("line one\nline two", {});
		expect(s.out()).toBe("line one\nline two\n");
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
