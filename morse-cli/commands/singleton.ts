import type { Command } from "commander";
import type { AppContext } from "../context.ts";
import {
	addSingleton,
	deleteSingleton,
	formatMist,
	listSingletons,
} from "../lib.ts";
import { die } from "../utils/output.ts";
import { readBlob, uploadBlob } from "../utils/walrus.ts";

export function addSingletonCommands(pub: Command, ctx: AppContext): void {
	const sing = pub
		.command("singleton")
		.description("Manage singletons within a publication");

	sing
		.command("add")
		.description("Add a singleton to a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Singleton name")
		.option("-t, --entry-type <mime>", "MIME type", "application/octet-stream")
		.option("-f, --file <path>", "Path to local file to upload")
		.option("--raw <content>", "Raw content string to upload")
		.action(async (options) => {
			try {
				if (!options.file && !options.raw) die("Provide --file or --raw");
				if (options.file && options.raw)
					die("--file and --raw are mutually exclusive");

				const content = options.file
					? await Bun.file(options.file).bytes()
					: new TextEncoder().encode(options.raw);

				const { blobObjectId, walCostMist } = await uploadBlob(ctx, content);

				process.stderr.write(`Adding singleton "${options.name}"...\n`);
				const digest = await addSingleton(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
					options.entryType,
					blobObjectId,
				);
				console.log(
					`Added singleton "${options.name}". (tx: ${digest})\n` +
						`  WAL cost: ${formatMist(walCostMist, "WAL")}`,
				);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	sing
		.command("list")
		.description("List singletons in a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.action(async (options) => {
			try {
				const singletons = await listSingletons(
					ctx.suiClient,
					options.publicationId,
				);
				if (singletons.length === 0) {
					console.log("No singletons found.");
					return;
				}
				for (const s of singletons) {
					console.log(`${s.name}  ${s.entryType}  ${s.blob}`);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	sing
		.command("get")
		.description("Get a singleton and its Walrus content")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Singleton name")
		.action(async (options) => {
			try {
				const singletons = await listSingletons(
					ctx.suiClient,
					options.publicationId,
				);
				const singleton = singletons.find((s) => s.name === options.name);
				if (!singleton) die(`No singleton named "${options.name}"`);

				process.stderr.write(
					`${singleton.name}  ${singleton.entryType}  ${singleton.blob}\n`,
				);
				await readBlob(ctx, singleton.blob);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	sing
		.command("delete")
		.description("Delete a singleton from a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Singleton name")
		.action(async (options) => {
			try {
				process.stderr.write(`Deleting singleton "${options.name}"...\n`);
				const digest = await deleteSingleton(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
				);
				console.log(`Deleted singleton "${options.name}". (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});
}
