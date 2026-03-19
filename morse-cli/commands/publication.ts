import type { Command } from "commander";
import type { AppContext } from "../context.ts";
import {
	createPublication,
	deletePublication,
	getPublication,
	listPublications,
} from "../lib.ts";
import { die } from "../utils/output.ts";

function vecMapKeys(v: unknown): string {
	const contents = (v as { contents?: { key: unknown }[] } | undefined)
		?.contents;
	if (!Array.isArray(contents) || contents.length === 0) return "(none)";
	return contents.map((e) => String(e.key)).join(", ");
}

export function addPublicationCommands(pub: Command, ctx: AppContext): void {
	pub
		.command("create")
		.description("Create a publication")
		.requiredOption("-n, --name <name>", "Name of the publication")
		.action(async (options) => {
			try {
				process.stderr.write(`Creating "${options.name}"...\n`);
				const digest = await createPublication(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.name,
				);
				console.log(`Created. (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	pub
		.command("get")
		.description("Get a single publication")
		.requiredOption("-i, --id <id>", "Sui ID of the publication")
		.option("--json", "Output raw JSON")
		.action(async (options) => {
			try {
				const publication = await getPublication(ctx.suiClient, options.id);
				if (options.json) {
					console.log(JSON.stringify(publication, null, 2));
				} else {
					const p = publication as {
						id?: string;
						name?: string;
						collections?: unknown;
						singletons?: unknown;
					};
					const name = p.name ?? options.id;
					const id: string = p.id ?? options.id;
					const shortId = `${id.slice(0, 6)}...${id.slice(-4)}`;
					console.log(`${name} (${shortId})`);
					console.log(`  Collections: ${vecMapKeys(p.collections)}`);
					console.log(`  Singletons:  ${vecMapKeys(p.singletons)}`);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	pub
		.command("list")
		.description("List all publications")
		.action(async () => {
			try {
				const publications = await listPublications(
					ctx.suiClient,
					ctx.keypair,
					ctx.originalPublicationAddress,
				);
				if (publications.length === 0) {
					console.log("No publications found.");
					return;
				}
				for (const p of publications) {
					console.log(`${p.id}  ${p.name}`);
				}
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});

	pub
		.command("delete")
		.description("Delete a publication")
		.requiredOption("-i, --id <id>", "Sui ID of the publication")
		.action(async (options) => {
			try {
				const publications = await listPublications(
					ctx.suiClient,
					ctx.keypair,
					ctx.originalPublicationAddress,
				);
				const entry = publications.find((p) => p.id === options.id);
				if (!entry)
					die(`Publication ${options.id} not found or you don't own it`);

				process.stderr.write(`Deleting "${entry.name}"...\n`);
				const { digest, name } = await deletePublication(
					ctx.suiClient,
					ctx.keypair,
					ctx.publicationAddress,
					options.id,
					entry.capId,
				);
				console.log(`Deleted "${name}". (tx: ${digest})`);
			} catch (e) {
				die(e instanceof Error ? e.message : String(e));
			}
		});
}
