import { beforeEach, describe, expect, test } from "bun:test";
import {
	runPublicationCreate,
	runPublicationDelete,
	runPublicationGet,
	runPublicationList,
	runPublicationTransferOwnership,
} from "../src/commands/publication.ts";
import { loadConfig } from "../src/config/store.ts";
import { useTempConfigHome } from "./support/config-home.ts";
import { readContext, writeContext } from "./support/context.ts";
import { ops, resetSdkMock } from "./support/sdk-mock.ts";

useTempConfigHome();
beforeEach(resetSdkMock);

const ID = `0x${"1".repeat(64)}`;
const NEW_ID = `0x${"b".repeat(64)}`; // matches the mocked createPublication result
const RECIPIENT = `0x${"2".repeat(64)}`;

describe("runPublicationGet", () => {
	test("renders the fetched publication", async () => {
		const { ctx, captured } = readContext({
			reader: {
				getPublication: () =>
					Promise.resolve({
						id: ID,
						slug: "blog",
						name: "My Blog",
						collections: [],
					}),
			} as never,
		});
		await runPublicationGet(ctx, ID);
		expect(captured.stdout()).toContain("My Blog");
		expect(captured.stdout()).toContain("slug:        blog");
	});

	test("--json emits the raw publication object", async () => {
		const { ctx, captured } = readContext({
			json: true,
			reader: {
				getPublication: () =>
					Promise.resolve({
						id: ID,
						slug: "blog",
						name: "My Blog",
						collections: [],
					}),
			} as never,
		});
		await runPublicationGet(ctx, ID);
		expect((captured.json() as { slug: string }).slug).toBe("blog");
	});
});

describe("runPublicationList", () => {
	test("enriches each owned publication with slug and name", async () => {
		const { ctx, captured } = readContext({
			reader: {
				listPublicationsOwnedBy: () =>
					Promise.resolve({
						results: [{ publicationId: ID, ownerCapId: `0x${"c".repeat(64)}` }],
						nextCursor: null,
					}),
				getPublication: () =>
					Promise.resolve({
						id: ID,
						slug: "blog",
						name: "Blog",
						collections: [],
					}),
			} as never,
		});
		await runPublicationList(ctx, undefined, {});
		expect(captured.stdout()).toContain("blog");
		expect(captured.stdout()).toContain("Blog");
	});

	test("--ids-only skips per-row reads", async () => {
		let getCalls = 0;
		const { ctx, captured } = readContext({
			reader: {
				listPublicationsOwnedBy: () =>
					Promise.resolve({
						results: [{ publicationId: ID, ownerCapId: `0x${"c".repeat(64)}` }],
						nextCursor: null,
					}),
				getPublication: () => {
					getCalls += 1;
					return Promise.resolve({
						id: ID,
						slug: "x",
						name: "x",
						collections: [],
					});
				},
			} as never,
		});
		await runPublicationList(ctx, undefined, { idsOnly: true });
		expect(getCalls).toBe(0);
		expect(captured.stdout()).toContain(ID);
	});

	test("throws when no address and no active account", async () => {
		const { ctx } = readContext({ ownerAddress: undefined });
		await expect(runPublicationList(ctx, undefined, {})).rejects.toThrow(
			/No address given/,
		);
	});
});

describe("runPublicationCreate", () => {
	test("delegates name/slug, renders, and selects the new publication", async () => {
		const { ctx, captured } = writeContext();
		await runPublicationCreate(ctx, { name: "My Pub", slug: "my-pub" }, {});
		expect(ops.createPublication).toHaveBeenCalledTimes(1);
		expect(ops.createPublication.mock.calls[0]?.[2]).toMatchObject({
			name: "My Pub",
			slug: "my-pub",
		});
		expect(captured.stdout()).toContain('Created "My Pub"');
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.publication).toBe(NEW_ID);
	});
});

describe("runPublicationDelete", () => {
	test("aborts (exit 2) without confirmation in a non-interactive context", async () => {
		const { ctx } = writeContext();
		await expect(
			runPublicationDelete(ctx, ID, {}, { yes: false }),
		).rejects.toThrow(/--yes/);
		expect(ops.deletePublication).not.toHaveBeenCalled();
	});

	test("with --yes resolves the owner cap, deletes, and clears the active selection", async () => {
		const { ctx, captured } = writeContext({
			settings: { publication: ID },
			reader: {
				listPublicationsOwnedBy: () =>
					Promise.resolve({
						results: [{ publicationId: ID, ownerCapId: `0x${"c".repeat(64)}` }],
						nextCursor: null,
					}),
			} as never,
		});
		await runPublicationDelete(ctx, ID, {}, { yes: true });
		expect(ops.deletePublication).toHaveBeenCalledTimes(1);
		expect(captured.stdout()).toContain(`Deleted ${ID}`);
		const cfg = await loadConfig();
		expect(cfg.profiles.default?.publication).toBeUndefined();
	});
});

describe("runPublicationTransferOwnership", () => {
	test("with --yes resolves owner cap and transfers", async () => {
		const { ctx, captured } = writeContext({
			reader: {
				listPublicationsOwnedBy: () =>
					Promise.resolve({
						results: [{ publicationId: ID, ownerCapId: `0x${"c".repeat(64)}` }],
						nextCursor: null,
					}),
			} as never,
		});
		await runPublicationTransferOwnership(
			ctx,
			RECIPIENT,
			{ publication: ID },
			{ yes: true },
		);
		expect(ops.transferOwnership).toHaveBeenCalledTimes(1);
		expect(ops.transferOwnership.mock.calls[0]?.[2]).toMatchObject({
			recipient: RECIPIENT,
		});
		expect(captured.stdout()).toContain("Transferred ownership");
	});

	test("declined transfer aborts before the op", async () => {
		const { ctx } = writeContext();
		await expect(
			runPublicationTransferOwnership(ctx, RECIPIENT, { publication: ID }, {}),
		).rejects.toThrow(/--yes/);
		expect(ops.transferOwnership).not.toHaveBeenCalled();
	});
});
