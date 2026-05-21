import { describe, expect, test } from "bun:test";
import { formatUserMessage } from "./errors.format.js";
import {
	ConfigurationError,
	ContractAbortError,
	NotFoundError,
	SealError,
	TransportError,
	UncertifiedBlobError,
	ValidationError,
} from "./errors.js";

describe("formatUserMessage — ContractAbortError", () => {
	test("known reason gets a friendly title and uses ABORT_CODES description", () => {
		const err = ContractAbortError.fromAbortCode("publication", 6); // ESlugAlreadyExists
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Slug already taken");
		expect(formatted.description).toBe(
			"A publication with this slug already exists.",
		);
		expect(formatted.cause).toBe(err);
	});

	test("EInvalidStorageMode overrides description (internal constants removed)", () => {
		const err = ContractAbortError.fromAbortCode("collection", 1);
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Invalid storage mode");
		expect(formatted.description).toBe("Storage mode must be Blob or Quilt.");
		// Confirms we did NOT use the SDK's internal description that mentions
		// STORAGE_MODE_BLOB (0) constants
		expect(formatted.description).not.toContain("STORAGE_MODE");
	});

	test("EInvalidQuiltPatchId overrides description (BCS byte layout removed)", () => {
		const err = ContractAbortError.fromAbortCode("entry", 11);
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Invalid quilt patch ID");
		expect(formatted.description).toBe(
			"QuiltPatchId must be exactly 37 bytes.",
		);
		expect(formatted.description).not.toContain("quilt_blob_id");
	});

	test("unknown abort code falls back to UnknownAbort title", () => {
		const err = ContractAbortError.fromAbortCode("publication", 999);
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Contract aborted");
		expect(formatted.description).toContain(
			"The deployed contract may be newer",
		);
	});

	test("preserves cause for caller narrowing", () => {
		const err = ContractAbortError.fromAbortCode("entry", 0); // ENameEmpty
		const formatted = formatUserMessage(err);
		expect(formatted.cause).toBe(err);
		expect(formatted.cause).toBeInstanceOf(ContractAbortError);
	});
});

describe("formatUserMessage — SealError", () => {
	test("each SealErrorCode maps to a distinct title and description", () => {
		const codes = [
			"no-access",
			"decrypt-failed",
			"session-expired",
			"rate-limited",
		] as const;
		const titles = new Set<string>();
		for (const code of codes) {
			const formatted = formatUserMessage(
				new SealError(code, "upstream message"),
			);
			expect(formatted.title.length).toBeGreaterThan(0);
			expect(formatted.description.length).toBeGreaterThan(0);
			titles.add(formatted.title);
		}
		expect(titles.size).toBe(4);
	});

	test("no-access carries a permission-focused description", () => {
		const formatted = formatUserMessage(
			new SealError("no-access", "key server denied"),
		);
		expect(formatted.title).toBe("No access");
		expect(formatted.description).toContain("permission");
	});
});

describe("formatUserMessage — UncertifiedBlobError", () => {
	test("description includes both blobId and blobObjectId for support traceability", () => {
		const err = new UncertifiedBlobError(
			"0xabc123",
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		);
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Upload incomplete");
		expect(formatted.description).toContain("0xabc123");
		expect(formatted.description).toContain(
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		);
		expect(formatted.description).toContain("Retry");
	});
});

describe("formatUserMessage — NotFoundError", () => {
	test("each NotFoundResource gets a distinct title", () => {
		const resources = [
			"publication",
			"collection",
			"entry",
			"revision",
			"publisher-cap",
			"owner-cap",
			"registry",
			"blob",
		] as const;
		const titles = new Set<string>();
		for (const resource of resources) {
			const formatted = formatUserMessage(
				new NotFoundError(resource, "id-123"),
			);
			titles.add(formatted.title);
		}
		expect(titles.size).toBe(resources.length);
	});

	test("blob resource has storage-operator-focused description", () => {
		const formatted = formatUserMessage(new NotFoundError("blob", "AAA"));
		expect(formatted.title).toBe("Content unavailable");
		expect(formatted.description).toContain("storage operator");
		expect(formatted.description).toContain("AAA");
	});

	test("on-chain resources reference the identifier directly", () => {
		const formatted = formatUserMessage(
			new NotFoundError("publication", "0xpub"),
		);
		expect(formatted.title).toBe("Publication not found");
		expect(formatted.description).toContain("0xpub");
	});
});

describe("formatUserMessage — ValidationError", () => {
	test("field name is prepended to message", () => {
		const err = new ValidationError("must be lowercase", "slug");
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Invalid input");
		expect(formatted.description).toBe("slug: must be lowercase");
	});

	test("empty field falls back to bare message", () => {
		const err = new ValidationError("something is off", "");
		const formatted = formatUserMessage(err);
		expect(formatted.description).toBe("something is off");
	});
});

describe("formatUserMessage — TransportError", () => {
	test("uses err.message when present", () => {
		const formatted = formatUserMessage(
			new TransportError("Walrus call failed: connection refused"),
		);
		expect(formatted.title).toBe("Network issue");
		expect(formatted.description).toContain("connection refused");
	});

	test("falls back to generic copy when message is empty", () => {
		const formatted = formatUserMessage(new TransportError(""));
		expect(formatted.title).toBe("Network issue");
		expect(formatted.description).toContain("retry");
	});

	test("appends operation discriminator when present", () => {
		const formatted = formatUserMessage(
			new TransportError("getObject failed", { operation: "sui.getObject" }),
		);
		expect(formatted.description).toBe("getObject failed (sui.getObject)");
	});

	test("does not append operation when undefined", () => {
		const formatted = formatUserMessage(new TransportError("getObject failed"));
		expect(formatted.description).toBe("getObject failed");
	});
});

describe("formatUserMessage — ConfigurationError", () => {
	test("uses err.message verbatim (ConfigurationError messages are already user-prose)", () => {
		const err = new ConfigurationError("Morse is not yet deployed on mainnet.");
		const formatted = formatUserMessage(err);
		expect(formatted.title).toBe("Configuration issue");
		expect(formatted.description).toBe("Morse is not yet deployed on mainnet.");
	});
});

describe("formatUserMessage — non-MorseError fallbacks", () => {
	test("raw Error uses its message", () => {
		const formatted = formatUserMessage(new Error("something broke"));
		expect(formatted.title).toBe("Unexpected error");
		expect(formatted.description).toBe("something broke");
	});

	test("non-Error throw gets a generic fallback", () => {
		const formatted = formatUserMessage("string throw");
		expect(formatted.title).toBe("Unexpected error");
		expect(formatted.description).toContain("unexpected");
	});

	test("undefined throw gets the generic fallback", () => {
		const formatted = formatUserMessage(undefined);
		expect(formatted.title).toBe("Unexpected error");
		expect(formatted.description.length).toBeGreaterThan(0);
	});

	test("preserves the original throw as cause for logging", () => {
		const original = { weird: "object" };
		const formatted = formatUserMessage(original);
		expect(formatted.cause).toBe(original);
	});
});

describe("formatUserMessage — every output is non-empty", () => {
	test("all returned title and description fields have content", () => {
		const samples: unknown[] = [
			ContractAbortError.fromAbortCode("publication", 6),
			ContractAbortError.fromAbortCode("publication", 9999),
			new SealError("no-access", "x"),
			new SealError("decrypt-failed", "x"),
			new SealError("session-expired", "x"),
			new SealError("rate-limited", "x"),
			new UncertifiedBlobError("0xabc", "AAA"),
			new NotFoundError("entry", "id"),
			new NotFoundError("blob", "id"),
			new ValidationError("msg", "field"),
			new TransportError("msg"),
			new ConfigurationError("msg"),
			new Error("raw"),
			"string",
			undefined,
			null,
		];
		for (const sample of samples) {
			const formatted = formatUserMessage(sample);
			expect(formatted.title.length).toBeGreaterThan(0);
			expect(formatted.description.length).toBeGreaterThan(0);
		}
	});
});
