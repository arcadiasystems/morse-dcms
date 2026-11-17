import { describe, expect, test } from "bun:test";

import { ExitCode } from "../src/cli/exit-codes.ts";
import {
	type CommandProcess,
	exitWhenFlushed,
	ignoreIdleSocketTimeouts,
	isIdleSocketTimeout,
} from "../src/cli/lifecycle.ts";

// The shape undici gives the error (nodejs/undici#6143), rebuilt here because
// the class is not exported by Node.
function idleSocketTimeout(): Error {
	const err = new Error("socket idle timeout");
	err.name = "InformationalError";
	return Object.assign(err, { code: "UND_ERR_INFO" });
}

function fakeProcess(exitCode?: number) {
	const state: {
		stderr: string;
		exitedWith: number | undefined;
		pendingFlushes: (() => void)[];
	} = { stderr: "", exitedWith: undefined, pendingFlushes: [] };
	let listener: ((err: unknown) => void) | undefined;
	// Hold each write callback until the test releases it, like a slow pipe.
	const stream = (sink: (text: string) => void) => ({
		write: (text: string, done?: () => void) => {
			sink(text);
			if (done !== undefined) {
				state.pendingFlushes.push(done);
			}
		},
	});
	const proc: CommandProcess = {
		on: (_event, registered) => {
			listener = registered;
		},
		exit: (code) => {
			state.exitedWith = code;
		},
		exitCode,
		stdout: stream(() => {}),
		stderr: stream((text) => {
			state.stderr += text;
		}),
	};
	return {
		proc,
		state,
		raise: (err: unknown): void => {
			if (listener === undefined) {
				throw new Error("no uncaughtException listener was registered");
			}
			listener(err);
		},
	};
}

function guardedProcess() {
	const fake = fakeProcess();
	ignoreIdleSocketTimeouts(fake.proc);
	return fake;
}

describe("isIdleSocketTimeout", () => {
	test("matches undici's idle HTTP/2 socket close", () => {
		expect(isIdleSocketTimeout(idleSocketTimeout())).toBe(true);
	});

	test("does not match other undici informational errors", () => {
		const other = idleSocketTimeout();
		other.message = "reset";
		expect(isIdleSocketTimeout(other)).toBe(false);
	});

	test("does not match an ordinary error with the same message", () => {
		expect(isIdleSocketTimeout(new Error("socket idle timeout"))).toBe(false);
		expect(isIdleSocketTimeout("socket idle timeout")).toBe(false);
	});
});

describe("ignoreIdleSocketTimeouts", () => {
	test("an idle socket close neither prints nor exits", () => {
		const { state, raise } = guardedProcess();
		raise(idleSocketTimeout());
		expect(state.stderr).toBe("");
		expect(state.exitedWith).toBeUndefined();
	});

	test("any other uncaught exception prints its trace and exits 1", () => {
		const { state, raise } = guardedProcess();
		raise(new TypeError("boom"));
		expect(state.stderr).toContain("TypeError: boom");
		expect(state.exitedWith).toBe(ExitCode.Generic);
	});

	test("a thrown non-error is printed as is", () => {
		const { state, raise } = guardedProcess();
		raise("plain string");
		expect(state.stderr).toBe("plain string\n");
		expect(state.exitedWith).toBe(ExitCode.Generic);
	});
});

describe("exitWhenFlushed", () => {
	test("waits for both streams to flush before exiting", async () => {
		const { proc, state } = fakeProcess(ExitCode.NotFound);
		const done = exitWhenFlushed(proc);
		expect(state.pendingFlushes).toHaveLength(2);
		state.pendingFlushes[0]?.();
		await Promise.resolve();
		expect(state.exitedWith).toBeUndefined();
		state.pendingFlushes[1]?.();
		await done;
		expect(state.exitedWith).toBe(ExitCode.NotFound);
	});

	test("exits 0 when no exit code was set", async () => {
		const { proc, state } = fakeProcess();
		const done = exitWhenFlushed(proc);
		for (const flush of state.pendingFlushes) {
			flush();
		}
		await done;
		expect(state.exitedWith).toBe(ExitCode.Success);
	});
});
