import type { Command } from "commander";
import type { AppContext } from "../context.ts";
import { addAsset, deleteAsset, formatMist, listAssets } from "../lib.ts";
import { die } from "../utils/output.ts";
import { uploadBlob } from "../utils/walrus.ts";

export function addAssetCommands(pub: Command, ctx: AppContext): void {
	const ast = pub
		.command("asset")
		.description("Manage static assets within a publication");

	ast
		.command("add")
		.description("Add a static asset to a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Asset name (e.g. img.png)")
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

				process.stderr.write(`Adding asset "${options.name}"...\n`);
				const digest = await addAsset(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
					options.entryType,
					blobObjectId,
				);
				console.log(
					`Added asset "${options.name}". (tx: ${digest})\n` +
						`  WAL cost: ${formatMist(walCostMist, "WAL")}`,
				);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	ast
		.command("list")
		.description("List static assets in a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.action(async (options) => {
			try {
				const assets = await listAssets(
					ctx.suiClient,
					options.publicationId,
				);
				if (assets.length === 0) {
					console.log("No assets found.");
					return;
				}
				for (const a of assets) {
					console.log(`${a.name}  ${a.entryType}  ${a.blob}`);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	ast
		.command("delete")
		.description("Delete a static asset from a publication")
		.requiredOption("-p, --publication-id <id>", "Publication ID")
		.requiredOption("-n, --name <name>", "Asset name")
		.action(async (options) => {
			try {
				process.stderr.write(`Deleting asset "${options.name}"...\n`);
				const digest = await deleteAsset(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.publicationId,
					options.name,
				);
				console.log(`Deleted asset "${options.name}". (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});
}
