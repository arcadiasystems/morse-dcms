/** `morse cap`: PublisherCap lifecycle (issue, list, revoke, destroy, transfer). */

import {
	destroyPublisherCap,
	issuePublisherCap,
	revokePublisherCap,
	toPublisherCapId,
	toSuiAddress,
	transferPublisherCap,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import { buildReadContext, buildWriteContext } from "../cli/context.ts";
import { cancelled, UsageError } from "../cli/errors.ts";
import { confirm } from "../cli/prompts.ts";
import { globalOptions } from "../cli/runtime.ts";
import { resolvePublication } from "../cli/target.ts";
import { renderPublisherCapList } from "../format/render.ts";
import {
	ownerCapOption,
	publicationOption,
	type TargetOptions,
} from "./options.ts";
import { resolveOwnerCap } from "./resolve.ts";
import { parseLimit } from "./shared.ts";

export function registerCapCommands(program: Command): void {
	const cap = program
		.command("cap")
		.description("Manage PublisherCaps (write-access capabilities)");

	cap
		.command("list [address]")
		.description(
			"List publisher caps held by an address (default: the active account)",
		)
		.option("--limit <n>", "Maximum results per page")
		.option("--cursor <cursor>", "Continue from a previous page cursor")
		.action(
			async (
				address: string | undefined,
				options: { limit?: string; cursor?: string },
				command: Command,
			) => {
				const ctx = await buildReadContext(command);
				const holder =
					address === undefined ? ctx.ownerAddress : toSuiAddress(address);
				if (holder === undefined) {
					throw new UsageError(
						"No address given and no active account. Pass an address or import an account.",
					);
				}
				const page = await ctx.reader.listPublisherCapsOwnedBy(holder, {
					signal: ctx.signal,
					...(options.limit === undefined
						? {}
						: { limit: parseLimit(options.limit) }),
					...(options.cursor === undefined ? {} : { cursor: options.cursor }),
				});
				if (page.nextCursor !== null) {
					ctx.output.info(`More results: pass --cursor "${page.nextCursor}"`);
				}
				ctx.output.result(renderPublisherCapList(page.results), {
					results: page.results,
					nextCursor: page.nextCursor,
				});
			},
		);

	const issue = cap
		.command("issue <holder>")
		.description("Issue a PublisherCap bound to an address");
	publicationOption(ownerCapOption(issue)).action(
		async (
			holder: string,
			options: TargetOptions & { ownerCap?: string },
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const holderAddress = toSuiAddress(holder);
			ctx.output.info("Resolving OwnerCap...");
			const ownerCapId = await resolveOwnerCap(
				ctx.reader,
				ctx.address,
				id,
				options.ownerCap,
				ctx.signal,
			);
			const result = await issuePublisherCap(ctx.adapter, ctx.config, {
				publicationId: id,
				ownerCapId,
				holder: holderAddress,
				signal: ctx.signal,
			});
			ctx.output.result(
				`Issued PublisherCap ${result.publisherCapId} to ${holderAddress}. (tx: ${result.digest})`,
				result,
			);
		},
	);

	const revoke = cap
		.command("revoke <publisherCapId>")
		.description("Revoke a PublisherCap so it can no longer write");
	publicationOption(ownerCapOption(revoke)).action(
		async (
			publisherCapId: string,
			options: TargetOptions & { ownerCap?: string },
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const capId = toPublisherCapId(publisherCapId);
			const proceed = await confirm(
				`Revoke PublisherCap ${capId}? It can no longer be used to write.`,
				{ assumeYes: Boolean(globalOptions(command).yes), signal: ctx.signal },
			);
			if (!proceed) {
				cancelled();
			}
			ctx.output.info("Resolving OwnerCap...");
			const ownerCapId = await resolveOwnerCap(
				ctx.reader,
				ctx.address,
				id,
				options.ownerCap,
				ctx.signal,
			);
			const result = await revokePublisherCap(ctx.adapter, ctx.config, {
				publicationId: id,
				ownerCapId,
				publisherCapId: capId,
				signal: ctx.signal,
			});
			ctx.output.result(
				`Revoked PublisherCap ${capId}. (tx: ${result.digest})`,
				result,
			);
		},
	);

	const destroy = cap
		.command("destroy <publisherCapId>")
		.description("Destroy a PublisherCap held by the active account");
	publicationOption(destroy).action(
		async (
			publisherCapId: string,
			options: TargetOptions,
			command: Command,
		) => {
			const ctx = await buildWriteContext(command);
			const id = await resolvePublication(ctx, options.publication);
			const capId = toPublisherCapId(publisherCapId);
			const proceed = await confirm(
				`Destroy PublisherCap ${capId}? This is permanent.`,
				{ assumeYes: Boolean(globalOptions(command).yes), signal: ctx.signal },
			);
			if (!proceed) {
				cancelled();
			}
			const result = await destroyPublisherCap(ctx.adapter, ctx.config, {
				publicationId: id,
				publisherCapId: capId,
				signal: ctx.signal,
			});
			ctx.output.result(
				`Destroyed PublisherCap ${capId}. (tx: ${result.digest})`,
				result,
			);
		},
	);

	cap
		.command("transfer <publisherCapId> <recipient>")
		.description("Transfer a PublisherCap object to another address")
		.action(
			async (
				publisherCapId: string,
				recipient: string,
				_options,
				command: Command,
			) => {
				const ctx = await buildWriteContext(command);
				const capId = toPublisherCapId(publisherCapId);
				const to = toSuiAddress(recipient);
				const proceed = await confirm(
					`Transfer PublisherCap ${capId} to ${to}?`,
					{
						assumeYes: Boolean(globalOptions(command).yes),
						signal: ctx.signal,
					},
				);
				if (!proceed) {
					cancelled();
				}
				const result = await transferPublisherCap(ctx.adapter, ctx.config, {
					publisherCapId: capId,
					recipient: to,
					signal: ctx.signal,
				});
				ctx.output.result(
					`Transferred PublisherCap ${capId} to ${to}. (tx: ${result.digest})`,
					result,
				);
			},
		);
}
