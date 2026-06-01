import { beforeEach, describe, expect, test } from "bun:test";
import {
	runCapDestroy,
	runCapIssue,
	runCapList,
	runCapRevoke,
	runCapTransfer,
} from "../src/commands/cap.ts";
import { readContext, writeContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);

const ID = `0x${"1".repeat(64)}`;
const HOLDER = `0x${"2".repeat(64)}`;
const CAP = `0x${"d".repeat(64)}`;
const RECIPIENT = `0x${"f".repeat(64)}`;

function ownerCapReader() {
	return {
		listPublicationsOwnedBy: () =>
			Promise.resolve({
				results: [{ publicationId: ID, ownerCapId: `0x${"c".repeat(64)}` }],
				nextCursor: null,
			}),
	} as never;
}

describe("runCapList", () => {
	test("renders held publisher caps", async () => {
		const { ctx, captured } = readContext({
			reader: {
				listPublisherCapsOwnedBy: () =>
					Promise.resolve({
						results: [{ id: CAP, publicationId: ID, holder: HOLDER }],
						nextCursor: null,
					}),
			} as never,
		});
		await runCapList(ctx, undefined, {});
		expect(captured.stdout()).toContain(CAP);
	});

	test("throws when no address and no active account", async () => {
		const { ctx } = readContext({ ownerAddress: undefined });
		await expect(runCapList(ctx, undefined, {})).rejects.toThrow(
			/No address given/,
		);
	});
});

describe("runCapIssue", () => {
	test("resolves the owner cap and issues to the holder", async () => {
		const { ctx, captured } = writeContext({ reader: ownerCapReader() });
		await runCapIssue(ctx, HOLDER, { publication: ID });
		expect(ops.issuePublisherCap).toHaveBeenCalledTimes(1);
		expect(ops.issuePublisherCap.mock.calls[0]?.[2]).toMatchObject({
			holder: HOLDER,
		});
		expect(captured.stdout()).toContain("Issued PublisherCap");
	});
});

describe("runCapRevoke", () => {
	test("aborts without --yes", async () => {
		const { ctx } = writeContext({ reader: ownerCapReader() });
		await expect(
			runCapRevoke(ctx, CAP, { publication: ID }, { yes: false }),
		).rejects.toThrow(/--yes/);
		expect(ops.revokePublisherCap).not.toHaveBeenCalled();
	});

	test("with --yes resolves owner cap and revokes", async () => {
		const { ctx, captured } = writeContext({ reader: ownerCapReader() });
		await runCapRevoke(ctx, CAP, { publication: ID }, { yes: true });
		expect(ops.revokePublisherCap).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Revoked PublisherCap");
	});
});

describe("runCapDestroy", () => {
	test("with --yes destroys the cap", async () => {
		const { ctx, captured } = writeContext();
		await runCapDestroy(ctx, CAP, { publication: ID }, { yes: true });
		expect(ops.destroyPublisherCap).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Destroyed PublisherCap");
	});
});

describe("runCapTransfer", () => {
	test("with --yes transfers the cap object", async () => {
		const { ctx, captured } = writeContext();
		await runCapTransfer(ctx, CAP, RECIPIENT, { yes: true });
		expect(ops.transferPublisherCap).toHaveBeenCalledTimes(1);
		expect(ops.transferPublisherCap.mock.calls[0]?.[2]).toMatchObject({
			recipient: RECIPIENT,
		});
		expect(captured.stdout()).toContain("Transferred PublisherCap");
	});

	test("aborts without --yes", async () => {
		const { ctx } = writeContext();
		await expect(runCapTransfer(ctx, CAP, RECIPIENT, {})).rejects.toThrow(
			/--yes/,
		);
		expect(ops.transferPublisherCap).not.toHaveBeenCalled();
	});
});
