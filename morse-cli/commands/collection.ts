import type { Command } from "commander";
import { addCollection, deleteCollection, listCollections } from "morse-sdk";
import type { AppContext } from "../context.ts";
import { die } from "../utils/output.ts";

export function addCollectionCommands(pub: Command, ctx: AppContext): void {
	const col = pub
		.command("collection")
		.description("Manage collections within a publication");

	col
		.command("add")
		.description("Add a collection to a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Collection name")
		.action(async (options) => {
			try {
				process.stderr.write(`Adding collection "${options.name}"...\n`);
				const digest = await addCollection(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
				);
				console.log(`Added collection "${options.name}". (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	col
		.command("list")
		.description("List collections in a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.action(async (options) => {
			try {
				const collections = await listCollections(
					ctx.suiClient,
					options.publicationId,
				);
				if (collections.length === 0) {
					console.log("No collections found.");
					return;
				}
				for (const name of collections) {
					console.log(name);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	col
		.command("delete")
		.description("Delete a collection from a publication (must be empty)")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Collection name")
		.action(async (options) => {
			try {
				process.stderr.write(`Deleting collection "${options.name}"...\n`);
				const digest = await deleteCollection(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
				);
				console.log(`Deleted collection "${options.name}". (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});
}
