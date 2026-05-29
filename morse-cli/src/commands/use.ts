/** `morse use` and `morse status`: manage and show the active context. */

import type { Command } from "commander";

import { buildReadContext } from "../cli/context.ts";
import { UsageError } from "../cli/errors.ts";
import { globalOptions, outputFor } from "../cli/runtime.ts";
import { resolvePublication } from "../cli/target.ts";
import { updateActiveProfile } from "../config/active.ts";
import { resolveSettings } from "../config/profile.ts";
import { loadConfig } from "../config/store.ts";
import { accountAddress } from "../keystore/source.ts";

export function registerContextCommands(program: Command): void {
	program
		.command("use [publication] [collection]")
		.description(
			"Set the active publication (slug or id) and optional collection. Omitting the collection clears any active collection.",
		)
		.option("--clear", "Clear the active publication and collection")
		.action(
			async (
				publication: string | undefined,
				collection: string | undefined,
				options: { clear?: boolean },
				command: Command,
			) => {
				const opts = globalOptions(command);
				const output = outputFor(command);
				if (options.clear) {
					const profile = await updateActiveProfile(opts, {
						publication: undefined,
						collection: undefined,
					});
					output.result(
						`Cleared the active publication and collection (profile "${profile}").`,
						{ profile, publication: null, collection: null },
					);
					return;
				}
				if (publication === undefined) {
					throw new UsageError(
						"Provide a publication (slug or id), or pass --clear.",
					);
				}
				const ctx = await buildReadContext(command);
				const publicationId = await resolvePublication(ctx, publication);
				let collectionName: string | undefined;
				if (collection !== undefined) {
					const pub = await ctx.reader.getPublication(
						publicationId,
						ctx.signal,
					);
					if (!pub.collections.some((c) => c.name === collection)) {
						throw new UsageError(
							`Publication ${publicationId} has no collection "${collection}".`,
						);
					}
					collectionName = collection;
				}
				const profile = await updateActiveProfile(opts, {
					publication: publicationId,
					collection: collectionName,
				});
				const human =
					collectionName === undefined
						? `Active publication set to ${publicationId} (profile "${profile}").`
						: `Active publication set to ${publicationId}, collection "${collectionName}" (profile "${profile}").`;
				output.result(human, {
					profile,
					publication: publicationId,
					collection: collectionName ?? null,
				});
			},
		);

	program
		.command("status")
		.description(
			"Show the active profile, network, account, publication, and collection",
		)
		.action(async (_options, command: Command) => {
			const output = outputFor(command);
			const settings = resolveSettings(
				globalOptions(command),
				await loadConfig(),
			);
			const account = accountAddress(settings.account);
			const human = [
				`profile:     ${settings.profileName}`,
				`network:     ${settings.network}`,
				`account:     ${account ?? "(none)"}`,
				`publication: ${settings.publication ?? "(none)"}`,
				`collection:  ${settings.collection ?? "(none)"}`,
			].join("\n");
			output.result(human, {
				profile: settings.profileName,
				network: settings.network,
				account: account ?? null,
				publication: settings.publication ?? null,
				collection: settings.collection ?? null,
			});
		});
}
