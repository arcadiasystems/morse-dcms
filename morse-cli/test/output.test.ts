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
