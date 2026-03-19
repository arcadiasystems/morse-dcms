import type { Command } from "commander";
import { addEntry, deleteEntry, formatMist, listEntries } from "morse-sdk";
import type { AppContext } from "../context.ts";
import { die } from "../utils/output.ts";
import { readBlob, uploadBlob } from "../utils/walrus.ts";

export function addEntryCommands(pub: Command, ctx: AppContext): void {
	const ent = pub
		.command("entry")
		.description("Manage entries within a collection");

	ent
		.command("add")
		.description("Add an entry to a collection")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-c, --collection <name>", "Collection name")
		.requiredOption("-n, --name <name>", "Entry name")
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

				process.stderr.write(
					`Adding entry "${options.name}" to "${options.collection}"...\n`,
				);
				const receipt = await addEntry(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.collection,
					options.name,
					options.entryType,
					blobObjectId,
				);
				console.log(
					`Added entry "${options.name}". (tx: ${receipt.digest})\n` +
						`  SUI gas:  ${formatMist(receipt.gasUsedMist)}\n` +
						`  WAL cost: ${formatMist(walCostMist, "WAL")}`,
				);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	ent
		.command("get")
		.description("Get a single entry and its Walrus content")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-c, --collection <name>", "Collection name")
		.requiredOption("--index <n>", "Entry index", Number.parseInt)
		.action(async (options) => {
			try {
				const entries = await listEntries(
					ctx.suiClient,
					options.publicationId,
					options.collection,
				);
				const entry = entries.find((e) => e.index === options.index);
				if (!entry) die(`No entry at index ${options.index}`);

				process.stderr.write(
					`${entry.index}  ${entry.name}  ${entry.entryType}  ${entry.blob}\n`,
				);
				await readBlob(ctx, entry.blob);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	ent
		.command("list")
		.description("List entries in a collection")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-c, --collection <name>", "Collection name")
		.action(async (options) => {
			try {
				const entries = await listEntries(
					ctx.suiClient,
					options.publicationId,
					options.collection,
				);
				if (entries.length === 0) {
					console.log("No entries found.");
					return;
				}
				for (const e of entries) {
					console.log(`${e.index}  ${e.name}  ${e.entryType}  ${e.blob}`);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	ent
		.command("delete")
		.description("Delete an entry from a collection by index")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-c, --collection <name>", "Collection name")
		.requiredOption("--index <n>", "Entry index", Number.parseInt)
		.action(async (options) => {
			try {
				process.stderr.write(
					`Deleting entry at index ${options.index} from "${options.collection}"...\n`,
				);
				const digest = await deleteEntry(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.collection,
					options.index,
				);
				console.log(`Deleted entry at index ${options.index}. (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});
}
