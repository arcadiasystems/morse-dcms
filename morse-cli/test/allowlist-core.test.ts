import { beforeEach, describe, expect, test } from "bun:test";
import {
	runAllowlistAddMember,
	runAllowlistCreate,
	runAllowlistDelete,
	runAllowlistGet,
	runAllowlistListCaps,
	runAllowlistRemoveMember,
	runAllowlistTransferCap,
} from "../src/commands/allowlist.ts";
import {
	allowlistWriteContext,
	filesReadContext,
	writeContext,
} from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

beforeEach(resetSdkMock);

const ALLOWLIST = `0x${"7".repeat(64)}`;
const CAP = `0x${"8".repeat(64)}`;
const MEMBER = `0x${"2".repeat(64)}`;
const RECIPIENT = `0x${"3".repeat(64)}`;

function capReader() {
	return {
		listAllowlistCapsOwnedBy: () =>
			Promise.resolve({
				results: [{ id: CAP, allowlistId: ALLOWLIST }],
				nextCursor: null,
			}),
	};
}

describe("runAllowlistCreate", () => {
	test("delegates the name and prints both ids", async () => {
		const { ctx, captured } = writeContext();
		await runAllowlistCreate(ctx, { name: "team-docs" });
		expect(ops.createAllowlist).toHaveBeenCalledTimes(1);
		expect(ops.createAllowlist.mock.calls[0]?.[2]).toMatchObject({
			name: "team-docs",
		});
		expect(captured.stdout()).toContain("team-docs");
		expect(captured.stdout()).toContain("cap:");
	});

	test("--json emits the allowlist id and cap id", async () => {
		const { ctx, captured } = writeContext({ json: true });
		await runAllowlistCreate(ctx, { name: "team-docs" });
		const out = captured.json() as { allowlistId: string; capId: string };
		expect(out.allowlistId.startsWith("0x")).toBe(true);
		expect(out.capId.startsWith("0x")).toBe(true);
	});
});

describe("runAllowlistAddMember", () => {
	test("requires --allowlist", async () => {
		const { ctx } = allowlistWriteContext({ filesReader: capReader() });
		await expect(runAllowlistAddMember(ctx, MEMBER, {})).rejects.toThrow(
			/--allowlist/,
		);
		expect(ops.addMember).not.toHaveBeenCalled();
	});

	test("auto-resolves the cap and adds the member", async () => {
		const { ctx, captured } = allowlistWriteContext({
			filesReader: capReader(),
		});
		await runAllowlistAddMember(ctx, MEMBER, { allowlist: ALLOWLIST });
		expect(ops.addMember).toHaveBeenCalledTimes(1);
		expect(ops.addMember.mock.calls[0]?.[2]).toMatchObject({
			capId: CAP,
			member: MEMBER,
		});
		expect(captured.stdout()).toContain("Added");
	});
});

describe("runAllowlistRemoveMember", () => {
	test("removes the member with the resolved cap", async () => {
		const { ctx, captured } = allowlistWriteContext({
			filesReader: capReader(),
		});
		await runAllowlistRemoveMember(ctx, MEMBER, { allowlist: ALLOWLIST });
		expect(ops.removeMember).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Removed");
	});
});

describe("runAllowlistTransferCap", () => {
	test("aborts without --yes", async () => {
		const { ctx } = allowlistWriteContext({ filesReader: capReader() });
		await expect(
			runAllowlistTransferCap(ctx, RECIPIENT, { allowlist: ALLOWLIST }, {}),
		).rejects.toThrow(/--yes/);
		expect(ops.transferAllowlistCap).not.toHaveBeenCalled();
	});

	test("with --yes resolves the cap and transfers", async () => {
		const { ctx, captured } = allowlistWriteContext({
			filesReader: capReader(),
		});
		await runAllowlistTransferCap(
			ctx,
			RECIPIENT,
			{ allowlist: ALLOWLIST },
			{ yes: true },
		);
		expect(ops.transferAllowlistCap).toHaveBeenCalledTimes(1);
		expect(ops.transferAllowlistCap.mock.calls[0]?.[2]).toMatchObject({
			capId: CAP,
			recipient: RECIPIENT,
		});
		expect(captured.stdout()).toContain("Transferred allowlist admin");
	});
});

describe("runAllowlistDelete", () => {
	test("aborts without --yes", async () => {
		const { ctx } = allowlistWriteContext({ filesReader: capReader() });
		await expect(
			runAllowlistDelete(ctx, { allowlist: ALLOWLIST }, {}),
		).rejects.toThrow(/--yes/);
		expect(ops.deleteAllowlist).not.toHaveBeenCalled();
	});

	test("with --yes deletes", async () => {
		const { ctx, captured } = allowlistWriteContext({
			filesReader: capReader(),
		});
		await runAllowlistDelete(ctx, { allowlist: ALLOWLIST }, { yes: true });
		expect(ops.deleteAllowlist).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain("Deleted allowlist");
	});
});

describe("runAllowlistGet", () => {
	test("renders name and members", async () => {
		const { ctx, captured } = filesReadContext({
			filesReader: {
				getAllowlist: () =>
					Promise.resolve({
						id: ALLOWLIST,
						name: "team-docs",
						members: [MEMBER],
					}),
			},
		});
		await runAllowlistGet(ctx, ALLOWLIST);
		expect(captured.stdout()).toContain("team-docs");
		expect(captured.stdout()).toContain(MEMBER);
		expect(captured.stdout()).toContain("members (1)");
	});
});

describe("runAllowlistListCaps", () => {
	test("renders held caps", async () => {
		const { ctx, captured } = filesReadContext({ filesReader: capReader() });
		await runAllowlistListCaps(ctx, undefined, {});
		expect(captured.stdout()).toContain(CAP);
	});

	test("throws when no address and no active account", async () => {
		const { ctx } = filesReadContext({ ownerAddress: undefined });
		await expect(runAllowlistListCaps(ctx, undefined, {})).rejects.toThrow(
			/no active account/,
		);
	});
});
