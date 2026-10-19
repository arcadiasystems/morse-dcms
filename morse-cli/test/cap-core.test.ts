import { beforeEach, describe, expect, test } from "bun:test";
import { NotFoundError, TransportError } from "@arcadiasystems/morse-sdk";
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

const REVOKED_CAP = `0x${"e".repeat(64)}`;
const ORPHANED_CAP = `0x${"9".repeat(64)}`;
const DELETED_PUBLICATION = `0x${"8".repeat(64)}`;

// Three held caps: one live, one revoked by the owner, one whose publication
// was deleted (the reader reports that publication as not found).
function heldCapsReader() {
	return {
		listPublisherCapsOwnedBy: () =>
			Promise.resolve({
				results: [
					{ id: CAP, publicationId: ID, holder: HOLDER },
					{ id: REVOKED_CAP, publicationId: ID, holder: HOLDER },
					{
						id: ORPHANED_CAP,
						publicationId: DELETED_PUBLICATION,
						holder: HOLDER,
					},
				],
				nextCursor: null,
			}),
		isPublisherCapRevoked: (publicationId: string, capId: string) => {
			if (publicationId === DELETED_PUBLICATION) {
				return Promise.reject(new NotFoundError("publication", publicationId));
			}
			return Promise.resolve(capId === REVOKED_CAP);
		},
	} as never;
}

describe("runCapList", () => {
	test("renders held publisher caps, marking the ones that cannot write", async () => {
		const { ctx, captured } = readContext({ reader: heldCapsReader() });
		await runCapList(ctx, undefined, {});
		const [live, revoked, orphaned] = captured.stdout().trimEnd().split("\n");
		expect(live).toStartWith(CAP);
		expect(live).not.toContain("[");
		expect(revoked).toStartWith(REVOKED_CAP);
		expect(revoked).toEndWith("[revoked]");
		expect(orphaned).toStartWith(ORPHANED_CAP);
		expect(orphaned).toEndWith("[publication deleted]");
	});

	test("--json carries each cap's status", async () => {
		const { ctx, captured } = readContext({
			reader: heldCapsReader(),
			json: true,
		});
		await runCapList(ctx, undefined, {});
		expect(captured.json()).toEqual({
			results: [
				{ id: CAP, publicationId: ID, holder: HOLDER, status: "active" },
				{
					id: REVOKED_CAP,
					publicationId: ID,
					holder: HOLDER,
					status: "revoked",
				},
				{
					id: ORPHANED_CAP,
					publicationId: DELETED_PUBLICATION,
					holder: HOLDER,
					status: "publication-deleted",
				},
			],
			nextCursor: null,
		});
	});

	test("a failed revocation lookup fails the command rather than reporting the cap active", async () => {
		const { ctx } = readContext({
			reader: {
				listPublisherCapsOwnedBy: () =>
					Promise.resolve({
						results: [{ id: CAP, publicationId: ID, holder: HOLDER }],
						nextCursor: null,
					}),
				isPublisherCapRevoked: () =>
					Promise.reject(new TransportError("getDynamicField failed")),
			} as never,
		});
		await expect(runCapList(ctx, undefined, {})).rejects.toBeInstanceOf(
			TransportError,
		);
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
