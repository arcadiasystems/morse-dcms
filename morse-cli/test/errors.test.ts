import { describe, expect, test } from "bun:test";
import {
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
	handleError,
	resolveExitCode,
	UsageError,
} from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";

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
