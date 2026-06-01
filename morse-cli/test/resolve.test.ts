import { describe, expect, test } from "bun:test";

import {
	type RpcPublicationReader,
	toPublicationId,
	toSuiAddress,
} from "@arcadiasystems/morse-sdk";

import { CliError } from "../src/cli/errors.ts";
import { ExitCode } from "../src/cli/exit-codes.ts";
import {
	resolveOwnerCap,
	resolvePublisherCap,
} from "../src/commands/resolve.ts";

const ADDRESS = toSuiAddress(`0x${"a".repeat(64)}`);
const PUB = toPublicationId(`0x${"b".repeat(64)}`);
const OTHER_PUB = toPublicationId(`0x${"e".repeat(64)}`);
const OWNER_CAP = `0x${"c".repeat(64)}`;
const PUBLISHER_CAP = `0x${"d".repeat(64)}`;
const SIGNAL = new AbortController().signal;

// Loosely typed: tests supply only the reader methods these helpers call, with
// just the result fields they read.
function reader(impl: Record<string, unknown>): RpcPublicationReader {
	return impl as unknown as RpcPublicationReader;
}

describe("resolveOwnerCap", () => {
	test("returns the explicit override without paging", async () => {
		const r = reader({
			listPublicationsOwnedBy: () => {
				throw new Error("should not page when override is given");
			},
		});
		expect(
			String(await resolveOwnerCap(r, ADDRESS, PUB, OWNER_CAP, SIGNAL)),
		).toBe(OWNER_CAP);
	});

	test("finds the owner cap by paging owned publications", async () => {
		const r = reader({
			listPublicationsOwnedBy: () =>
				Promise.resolve({
					results: [{ publicationId: PUB, ownerCapId: OWNER_CAP }],
					nextCursor: null,
				}),
		});
		expect(
			String(await resolveOwnerCap(r, ADDRESS, PUB, undefined, SIGNAL)),
		).toBe(OWNER_CAP);
	});

	test("follows the cursor to a later page", async () => {
		let calls = 0;
		const r = reader({
			listPublicationsOwnedBy: () => {
				calls += 1;
				if (calls === 1) {
					return Promise.resolve({
						results: [{ publicationId: OTHER_PUB, ownerCapId: "0xnope" }],
						nextCursor: "next",
					});
				}
				return Promise.resolve({
					results: [{ publicationId: PUB, ownerCapId: OWNER_CAP }],
					nextCursor: null,
				});
			},
		});
		expect(
			String(await resolveOwnerCap(r, ADDRESS, PUB, undefined, SIGNAL)),
		).toBe(OWNER_CAP);
		expect(calls).toBe(2);
	});

	test("throws a not-found CliError when no owner cap matches", async () => {
		const r = reader({
			listPublicationsOwnedBy: () =>
				Promise.resolve({ results: [], nextCursor: null }),
		});
		const err = await resolveOwnerCap(r, ADDRESS, PUB, undefined, SIGNAL).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(CliError);
		expect((err as CliError).exitCode).toBe(ExitCode.NotFound);
	});
});

describe("resolvePublisherCap", () => {
	test("returns the explicit override", async () => {
		const r = reader({
			listPublisherCapsOwnedBy: () => {
				throw new Error("should not page when override is given");
			},
		});
		expect(
			String(await resolvePublisherCap(r, ADDRESS, PUB, PUBLISHER_CAP, SIGNAL)),
		).toBe(PUBLISHER_CAP);
	});

	test("finds the publisher cap for the publication", async () => {
		const r = reader({
			listPublisherCapsOwnedBy: () =>
				Promise.resolve({
					results: [{ id: PUBLISHER_CAP, publicationId: PUB }],
					nextCursor: null,
				}),
		});
		expect(
			String(await resolvePublisherCap(r, ADDRESS, PUB, undefined, SIGNAL)),
		).toBe(PUBLISHER_CAP);
	});

	test("throws a not-found CliError when none matches", async () => {
		const r = reader({
			listPublisherCapsOwnedBy: () =>
				Promise.resolve({ results: [], nextCursor: null }),
		});
		const err = await resolvePublisherCap(
			r,
			ADDRESS,
			PUB,
			undefined,
			SIGNAL,
		).catch((e) => e);
		expect(err).toBeInstanceOf(CliError);
		expect((err as CliError).exitCode).toBe(ExitCode.NotFound);
	});
});
