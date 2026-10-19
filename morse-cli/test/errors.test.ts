import { describe, expect, test } from "bun:test";
import {
	BlobExpiredError,
	ConfigurationError,
	ContractAbortError,
	NotFoundError,
	SealError,
	TransportError,
	UnauthorizedError,
	UncertifiedBlobError,
	ValidationError,
} from "@arcadiasystems/morse-sdk";
import { CommanderError } from "commander";

import {
	CliError,
	cancelled,
	handleError,
	resolveExitCode,
	UsageError,
} from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";

/** Run with process.stderr.write swallowed; return the value and what was written. */
function captureStderr<T>(fn: () => T): { value: T; stderr: string } {
	let buffer = "";
	const original = process.stderr.write.bind(process.stderr);
	(process.stderr as { write: unknown }).write = (text: string): boolean => {
		buffer += text;
		return true;
	};
	try {
		const value = fn();
		return { value, stderr: buffer };
	} finally {
		(process.stderr as { write: unknown }).write = original;
	}
}

describe("resolveExitCode", () => {
	test("CliError carries its own code", () => {
		expect(resolveExitCode(new UsageError("bad input"))).toBe(ExitCode.Usage);
		expect(resolveExitCode(new CliError("boom"))).toBe(ExitCode.Generic);
	});

	test("NotFoundError maps to 3", () => {
		expect(resolveExitCode(new NotFoundError("publication", "0x1"))).toBe(
			ExitCode.NotFound,
		);
	});

	test("UnauthorizedError maps to 4", () => {
		expect(resolveExitCode(new UnauthorizedError("nope"))).toBe(ExitCode.Auth);
	});

	test("revoked-cap abort maps to 4, other aborts to 1", () => {
		expect(
			resolveExitCode(ContractAbortError.fromAbortCode("publication", 5)),
		).toBe(ExitCode.Auth);
		expect(
			resolveExitCode(ContractAbortError.fromAbortCode("publication", 6)),
		).toBe(ExitCode.Generic);
	});

	test("TransportError maps to 5", () => {
		expect(resolveExitCode(new TransportError("rpc down"))).toBe(
			ExitCode.Network,
		);
	});

	test("ConfigurationError maps to 2", () => {
		expect(resolveExitCode(new ConfigurationError("misconfigured"))).toBe(
			ExitCode.Usage,
		);
	});

	test("ValidationError (invalid input) maps to 2; unknown errors map to 1", () => {
		expect(resolveExitCode(new ValidationError("bad", "slug"))).toBe(
			ExitCode.Usage,
		);
		expect(resolveExitCode(new Error("unexpected"))).toBe(ExitCode.Generic);
	});

	test("UncertifiedBlobError maps to 1", () => {
		expect(resolveExitCode(new UncertifiedBlobError("0xobj", "blobid"))).toBe(
			ExitCode.Generic,
		);
	});

	test("an expired blob is a not-found (3); a live blob the nodes did not return is a network failure (5)", () => {
		const expired = new BlobExpiredError("blobid", {
			blobObjectId: "0xobj",
			endEpoch: 12,
			currentEpoch: 15,
		});
		expect(resolveExitCode(expired)).toBe(ExitCode.NotFound);
		const unreturned = new TransportError(
			"Walrus storage nodes did not return blob blobid",
			{ operation: "walrus.readBlob" },
		);
		expect(resolveExitCode(unreturned)).toBe(ExitCode.Network);
	});

	test("SealError no-access maps to 4, other Seal codes to 1", () => {
		expect(resolveExitCode(new SealError("no-access", "denied"))).toBe(
			ExitCode.Auth,
		);
		expect(resolveExitCode(new SealError("decrypt-failed", "bad"))).toBe(
			ExitCode.Generic,
		);
	});
});

describe("handleError commander codes", () => {
	test("help and version exit successfully without rendering", () => {
		const help = new CommanderError(0, "commander.helpDisplayed", "");
		const version = new CommanderError(0, "commander.version", "");
		expect(handleError(help, { json: false, debug: false })).toBe(
			ExitCode.Success,
		);
		expect(handleError(version, { json: false, debug: false })).toBe(
			ExitCode.Success,
		);
	});

	test("parse failures map to usage", () => {
		const unknown = new CommanderError(
			1,
			"commander.unknownOption",
			"unknown option",
		);
		expect(handleError(unknown, { json: false, debug: false })).toBe(
			ExitCode.Usage,
		);
	});
});

describe("renderError via handleError", () => {
	test("plain mode writes a CliError message to stderr", () => {
		const { value, stderr } = captureStderr(() =>
			handleError(new UsageError("bad input"), { json: false, debug: false }),
		);
		expect(value).toBe(ExitCode.Usage);
		expect(stderr).toContain("Error: bad input");
	});

	test("json mode writes a structured error document to stderr", () => {
		const { value, stderr } = captureStderr(() =>
			handleError(new NotFoundError("publication", "0x1"), {
				json: true,
				debug: false,
			}),
		);
		expect(value).toBe(ExitCode.NotFound);
		const parsed = JSON.parse(stderr) as {
			error: { exitCode: number; title: string };
		};
		expect(parsed.error.exitCode).toBe(ExitCode.NotFound);
		expect(parsed.error.title).toBeDefined();
	});

	test("a blob not-found names the blob id, not the cause, and does not blame expiry", () => {
		const { stderr } = captureStderr(() =>
			handleError(new NotFoundError("blob", "blobid"), {
				json: false,
				debug: false,
			}),
		);
		expect(stderr).toBe(
			"Error: Walrus has no stored copy of this content. (id: blobid)\n",
		);
	});

	test("a storage-node read failure suggests --via-aggregator", () => {
		const err = new TransportError(
			"Walrus storage nodes did not return blob blobid",
			{ operation: "walrus.readBlob" },
		);
		const { value, stderr } = captureStderr(() =>
			handleError(err, { json: false, debug: false }),
		);
		expect(value).toBe(ExitCode.Network);
		expect(stderr).toBe(
			"Error: Walrus storage nodes did not return blob blobid (walrus.readBlob) Retry, or pass --via-aggregator to read through a Walrus aggregator.\n",
		);
	});

	test("other network failures carry no aggregator hint", () => {
		const { stderr } = captureStderr(() =>
			handleError(
				new TransportError("getObject failed", {
					operation: "sui.getObject",
				}),
				{ json: false, debug: false },
			),
		);
		expect(stderr).not.toContain("--via-aggregator");
	});

	test("debug mode appends a stack trace, following the cause chain", () => {
		const err = new CliError("outer", ExitCode.Generic, {
			cause: new Error("inner cause"),
		});
		const { stderr } = captureStderr(() =>
			handleError(err, { json: false, debug: true }),
		);
		expect(stderr).toContain("Error: outer");
		expect(stderr).toContain("Caused by:");
	});
});

describe("cancelled", () => {
	test("throws a usage error", () => {
		expect(() => cancelled()).toThrow(/Cancelled/);
	});
});
