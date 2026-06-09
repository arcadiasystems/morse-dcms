import { beforeEach, describe, expect, test } from "bun:test";
import { runFileList } from "../src/commands/file.ts";
import { fileListContext } from "./support/context.ts";
import { ops, resetSdkMock, SUMMARY } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);

const FILE = `0x${"9".repeat(64)}`;

describe("runFileList", () => {
	test("owned: reconciles owned files and renders them", async () => {
		const { ctx, captured } = fileListContext();
		await runFileList(ctx, {});
		expect(ops.reconcileRecipientFilesOwnedBy).toHaveBeenCalledTimes(1);
		expect(ops.reconcileRecipientFilesAccessibleBy).not.toHaveBeenCalled();
		expect(captured.stdout()).toContain("file.txt");
	});

	test("accessible: switches to the membership reconcile helper", async () => {
		const { ctx } = fileListContext();
		await runFileList(ctx, { accessible: true });
		expect(ops.reconcileRecipientFilesAccessibleBy).toHaveBeenCalledTimes(1);
		expect(ops.reconcileRecipientFilesOwnedBy).not.toHaveBeenCalled();
	});

	test("owned listing fetches metadata and recipient events so renames/recipients are current", async () => {
		const queried: string[] = [];
		const { ctx } = fileListContext();
		const events = {
			queryEvents: (params: { query: { MoveEventType: string } }) => {
				queried.push(params.query.MoveEventType);
				return Promise.resolve({
					data: [],
					hasNextPage: false,
					nextCursor: null,
				});
			},
		};
		await runFileList({ ...ctx, events } as never, {});
		expect(queried).toContain("RecipientFileMetadataUpdated");
		expect(queried).toContain("RecipientAdded");
		expect(queried).toContain("RecipientRemoved");
	});

	test("throws when no address and no active account", async () => {
		const { ctx } = fileListContext({ ownerAddress: undefined });
		await expect(runFileList(ctx, {})).rejects.toThrow(
			/--address|active account/,
		);
	});

	test("empty result renders an empty array and exits successfully", async () => {
		ops.reconcileRecipientFilesOwnedBy.mockReturnValueOnce([]);
		const { ctx, captured } = fileListContext({ json: true });
		await runFileList(ctx, {});
		expect(captured.json()).toEqual([]);
	});

	test("--hydrate fetches the full record for each summary", async () => {
		let getCalls = 0;
		const { ctx, captured } = fileListContext({
			json: true,
			filesReader: {
				getRecipientFile: () => {
					getCalls += 1;
					return Promise.resolve({
						id: FILE,
						owner: `0x${"a".repeat(64)}`,
						blobId: "A".repeat(43),
						blobObjectId: null,
						name: "file.txt",
						contentType: "text/plain",
						size: 10,
						members: [`0x${"7".repeat(64)}`],
						createdAtMs: 1,
					});
				},
			},
		});
		await runFileList(ctx, { hydrate: true });
		expect(getCalls).toBe(1);
		const items = captured.json() as Array<{ kind: string }>;
		expect(items[0]?.kind).toBe("full");
	});

	test("--limit caps the result count", async () => {
		ops.reconcileRecipientFilesOwnedBy.mockReturnValueOnce([
			SUMMARY,
			{ ...SUMMARY, id: `0x${"1".repeat(64)}` },
			{ ...SUMMARY, id: `0x${"2".repeat(64)}` },
		]);
		const { ctx, captured } = fileListContext({ json: true });
		await runFileList(ctx, { limit: "2" });
		expect((captured.json() as unknown[]).length).toBe(2);
	});
});
