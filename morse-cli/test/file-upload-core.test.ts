import { beforeEach, describe, expect, test } from "bun:test";
import { runFileUpload } from "../src/commands/file.ts";
import { useTempFiles } from "./support/content.ts";
import { encryptContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);
const files = useTempFiles();

const RECIPIENT = `0x${"7".repeat(64)}`;

describe("runFileUpload", () => {
	test("requires --public, --encrypt, or --recipient", async () => {
		const { ctx } = encryptContext();
		await expect(runFileUpload(ctx, "x", { name: "doc" })).rejects.toThrow(
			/--public|--encrypt/,
		);
		expect(ops.uploadEncryptedRecipientFileFromBytes).not.toHaveBeenCalled();
		expect(ops.uploadRecipientFileFromBytes).not.toHaveBeenCalled();
	});

	test("rejects both --public and --encrypt", async () => {
		const { ctx } = encryptContext();
		await expect(
			runFileUpload(ctx, "x", { name: "doc", public: true, encrypt: true }),
		).rejects.toThrow(/not both/);
	});

	test("rejects --recipient on a public upload", async () => {
		const { ctx } = encryptContext();
		await expect(
			runFileUpload(ctx, "x", {
				name: "doc",
				public: true,
				recipient: [RECIPIENT],
			}),
		).rejects.toThrow(/--recipient/);
	});

	test("rejects a non-positive --epochs before reading the file", async () => {
		const { ctx } = encryptContext();
		await expect(
			runFileUpload(ctx, "x", { name: "doc", public: true, epochs: "0" }),
		).rejects.toThrow(/--epochs/);
		expect(ops.uploadRecipientFileFromBytes).not.toHaveBeenCalled();
	});

	test("encrypted: uploads with recipients, epochs, and emits a share string", async () => {
		const file = await files.write("doc.txt", "secret");
		const { ctx, captured } = encryptContext({ json: true });
		await runFileUpload(ctx, file, {
			name: "doc.txt",
			recipient: [RECIPIENT],
			epochs: "2",
		});
		expect(ops.uploadEncryptedRecipientFileFromBytes).toHaveBeenCalledTimes(1);
		expect(
			ops.uploadEncryptedRecipientFileFromBytes.mock.calls[0]?.[2],
		).toMatchObject({
			recipients: [RECIPIENT],
			name: "doc.txt",
			contentType: "text/plain",
			upload: { epochs: 2, deletable: true },
		});
		const out = captured.json() as {
			share: string;
			fileId: string;
			sealIdPrefix: string;
			sealNonce: string;
		};
		expect(out.share.startsWith("mf1.")).toBe(true);
		expect(out.fileId.startsWith("0x")).toBe(true);
		expect(typeof out.sealIdPrefix).toBe("string");
		expect(typeof out.sealNonce).toBe("string");
	});

	test("public: uploads world-readable bytes and prints a view link", async () => {
		const file = await files.write("logo.png", "bytes");
		const { ctx, captured } = encryptContext();
		await runFileUpload(ctx, file, { name: "logo.png", public: true });
		expect(ops.uploadRecipientFileFromBytes).toHaveBeenCalledTimes(1);
		expect(ops.uploadRecipientFileFromBytes.mock.calls[0]?.[2]).toMatchObject({
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
