import { describe, expect, test } from "bun:test";

import {
	ABORT_CODES,
	type AbortModule,
	ConfigurationError,
	ContractAbortError,
	MorseError,
	NotFoundError,
	TransportError,
	UNKNOWN_ABORT_NAME,
	UnauthorizedError,
	ValidationError,
} from "./errors.js";

describe("MorseError hierarchy", () => {
	test("ValidationError extends MorseError and Error", () => {
		const error = new ValidationError("bad input", "foo");
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).toBeInstanceOf(MorseError);
		expect(error).toBeInstanceOf(Error);
	});

	test("ValidationError exposes field and message", () => {
		const error = new ValidationError("bad input", "foo");
		expect(error.field).toBe("foo");
		expect(error.message).toBe("bad input");
		expect(error.name).toBe("ValidationError");
	});

	test("NotFoundError exposes resource and identifier", () => {
		const error = new NotFoundError("publication", "0xdeadbeef");
		expect(error).toBeInstanceOf(NotFoundError);
		expect(error).toBeInstanceOf(MorseError);
		expect(error.resource).toBe("publication");
		expect(error.identifier).toBe("0xdeadbeef");
		expect(error.message).toBe("publication not found: 0xdeadbeef");
	});

	test("UnauthorizedError carries its message", () => {
		const error = new UnauthorizedError("no cap");
		expect(error).toBeInstanceOf(UnauthorizedError);
		expect(error).toBeInstanceOf(MorseError);
		expect(error.message).toBe("no cap");
	});

	test("TransportError extends MorseError and carries cause", () => {
		const root = new Error("connection refused");
		const error = new TransportError("RPC unreachable", { cause: root });
		expect(error).toBeInstanceOf(TransportError);
		expect(error).toBeInstanceOf(MorseError);
		expect(error.message).toBe("RPC unreachable");
		expect(error.cause).toBe(root);
		expect(error.name).toBe("TransportError");
	});

	test("TransportError.operation is undefined when omitted", () => {
		const error = new TransportError("oops");
		expect(error.operation).toBeUndefined();
	});

	test("TransportError.operation carries the discriminator when provided", () => {
		const error = new TransportError("oops", { operation: "sui.getObject" });
		expect(error.operation).toBe("sui.getObject");
	});

	test("ConfigurationError extends MorseError", () => {
		const error = new ConfigurationError("no deployment");
		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error).toBeInstanceOf(MorseError);
		expect(error.message).toBe("no deployment");
		expect(error.name).toBe("ConfigurationError");
	});

	test("preserves cause through the Error options", () => {
		const root = new Error("network down");
		const error = new ValidationError("upstream failed", "input", {
			cause: root,
		});
		expect(error.cause).toBe(root);
	});
});

describe("ContractAbortError", () => {
	test("fromAbortCode resolves known codes to named reasons", () => {
		const error = ContractAbortError.fromAbortCode("publication", 5);
		expect(error.module).toBe("publication");
		expect(error.abortCode).toBe(5);
		expect(error.reason).toBe("EPublisherCapRevoked");
		expect(error.message).toContain("publication::EPublisherCapRevoked");
		expect(error.message).toContain("code 5");
	});

	test("fromAbortCode falls back to UnknownAbort for unlisted codes", () => {
		const error = ContractAbortError.fromAbortCode("publication", 9999);
		expect(error.reason).toBe(UNKNOWN_ABORT_NAME);
		expect(error.abortCode).toBe(9999);
		expect(error.message).toContain("unknown code 9999");
	});

	test("fromAbortCode supports each known module", () => {
		const modules: AbortModule[] = ["publication", "collection", "entry"];
		for (const module of modules) {
			const codes = Object.keys(ABORT_CODES[module]).map(Number);
			expect(codes.length).toBeGreaterThan(0);
			for (const code of codes) {
				const error = ContractAbortError.fromAbortCode(module, code);
				expect(error.module).toBe(module);
				expect(error.abortCode).toBe(code);
				expect(error.reason).not.toBe(UNKNOWN_ABORT_NAME);
				expect(error.reason.startsWith("E")).toBe(true);
			}
		}
	});

	test("fromAbortCode preserves cause", () => {
		const root = new Error("rpc failure");
		const error = ContractAbortError.fromAbortCode("publication", 5, {
			cause: root,
		});
		expect(error.cause).toBe(root);
	});
});

describe("ABORT_CODES table", () => {
	test("every entry has a non-empty name and description", () => {
		const modules: AbortModule[] = ["publication", "collection", "entry"];
		for (const module of modules) {
			const entries = ABORT_CODES[module];
			const codes = Object.keys(entries);
			expect(codes.length).toBeGreaterThan(0);
			for (const code of codes) {
				const entry = entries[Number(code)];
				expect(entry).toBeDefined();
				if (entry === undefined) {
					continue;
				}
				expect(entry.name.length).toBeGreaterThan(0);
				expect(entry.name.startsWith("E")).toBe(true);
				expect(entry.description.length).toBeGreaterThan(0);
			}
		}
	});

	test("publication module covers expected abort names", () => {
		const names = Object.values(ABORT_CODES.publication).map((e) => e.name);
		expect(names).toContain("ECollectionAlreadyExists");
		expect(names).toContain("EPublisherCapRevoked");
		expect(names).toContain("ESlugAlreadyExists");
		expect(names).toContain("ESealInvalidId");
	});

	test("collection module covers expected abort names", () => {
		const names = Object.values(ABORT_CODES.collection).map((e) => e.name);
		expect(names).toContain("EEntryNotFound");
		expect(names).toContain("EInvalidStorageMode");
	});

	test("entry module covers expected abort names", () => {
		const names = Object.values(ABORT_CODES.entry).map((e) => e.name);
		expect(names).toContain("ENameEmpty");
		expect(names).toContain("EBlobNotDeletable");
		expect(names).toContain("EInvalidQuiltPatchId");
	});
});
