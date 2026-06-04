import { beforeEach, describe, expect, test } from "bun:test";
import { runFileUpload } from "../src/commands/file.ts";
import { useTempFiles } from "./support/content.ts";
import { encryptContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);
const files = useTempFiles();

const ALLOWLIST = `0x${"7".repeat(64)}`;

describe("runFileUpload", () => {
	test("requires --allowlist or --public", async () => {
		const { ctx } = encryptContext();
		await expect(runFileUpload(ctx, "x", { name: "doc" })).rejects.toThrow(
			/--allowlist|--public/,
		);
		expect(ops.uploadEncryptedFileFromBytes).not.toHaveBeenCalled();
		expect(ops.uploadPublicFileFromBytes).not.toHaveBeenCalled();
	});

	test("rejects a non-positive --epochs before reading the file", async () => {
		const { ctx } = encryptContext();
		await expect(
			runFileUpload(ctx, "x", { name: "doc", public: true, epochs: "0" }),
		).rejects.toThrow(/--epochs/);
		expect(ops.uploadPublicFileFromBytes).not.toHaveBeenCalled();
	});

	test("encrypted: uploads with allowlist, epochs, and emits a sealId", async () => {
		const file = await files.write("doc.txt", "secret");
		const { ctx, captured } = encryptContext({ json: true });
		await runFileUpload(ctx, file, {
			name: "doc.txt",
			allowlist: ALLOWLIST,
			epochs: "2",
		});
		expect(ops.uploadEncryptedFileFromBytes).toHaveBeenCalledTimes(1);
		expect(ops.uploadEncryptedFileFromBytes.mock.calls[0]?.[2]).toMatchObject({
			allowlistId: ALLOWLIST,
			name: "doc.txt",
			contentType: "text/plain",
			upload: { epochs: 2, deletable: true },
		});
		const out = captured.json() as { sealId: string; fileId: string };
		expect(out.sealId.startsWith("0x")).toBe(true);
		expect(out.fileId.startsWith("0x")).toBe(true);
	});

	test("public: uploads world-readable bytes and prints a view link", async () => {
		const file = await files.write("logo.png", "bytes");
		const { ctx, captured } = encryptContext();
		await runFileUpload(ctx, file, { name: "logo.png", public: true });
		expect(ops.uploadPublicFileFromBytes).toHaveBeenCalledTimes(1);
		expect(ops.uploadPublicFileFromBytes.mock.calls[0]?.[2]).toMatchObject({
			name: "logo.png",
			contentType: "image/png",
		});
		expect(captured.stdout()).toContain("Uploaded public file");
		expect(captured.stdout()).toContain("view:");
	});

	test("public --json emits the fileId and a viewUrl", async () => {
		const file = await files.write("logo.png", "bytes");
		const { ctx, captured } = encryptContext({ json: true });
		await runFileUpload(ctx, file, { name: "logo.png", public: true });
		const out = captured.json() as { fileId: string; viewUrl: string | null };
		expect(out.fileId.startsWith("0x")).toBe(true);
		expect(typeof out.viewUrl).toBe("string");
	});
});
