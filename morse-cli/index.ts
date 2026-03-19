#!/usr/bin/env bun

import "dotenv/config";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { blobIdFromInt, walrus } from "@mysten/walrus";
import { Command } from "commander";
import {
	addCollection,
	addEntry,
	addSingleton,
	createPublication,
	deleteCollection,
	deleteEntry,
	deletePublication,
	deleteSingleton,
	formatMist,
	getPublication,
	listCollections,
	listEntries,
	listPublications,
	listSingletons,
} from "./lib.ts";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const keypair = Ed25519Keypair.fromSecretKey(PRIVATE_KEY);

const PUBLICATION_ADDRESS = process.env.PUBLICATION_ADDRESS || "";
const ORIGINAL_PUBLICATION_ADDRESS =
	process.env.ORIGINAL_PUBLICATION_ADDRESS || "";
const SUI_RPC_URL = process.env.SUI_RPC_URL || "";

const program = new Command();

const suiClient = new SuiGrpcClient({
	network: "testnet",
	baseUrl: SUI_RPC_URL,
}).$extend(walrus());

function die(msg: string): never {
	process.stderr.write(`Error: ${msg}\n`);
	process.exit(1);
}

function vecMapKeys(v: unknown): string {
	const contents = (v as { contents?: { key: unknown }[] } | undefined)
		?.contents;
	if (!Array.isArray(contents) || contents.length === 0) return "(none)";
	return contents.map((e) => String(e.key)).join(", ");
}

program
	.name("morse-cli")
	.description("CLI for working with Morse publications")
	.version("0.0.1");

const pub = program.command("pub").description("Manage publications");

pub
	.command("create")
	.description("Create a publication")
	.requiredOption("--name <name>", "Name of the publication")
	.action(async (options) => {
		try {
			process.stderr.write(`Creating "${options.name}"...\n`);
			const digest = await createPublication(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
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
	.requiredOption("--id <id>", "Sui ID of the publication")
	.option("--json", "Output raw JSON")
	.action(async (options) => {
		try {
			const publication = await getPublication(suiClient, options.id);
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
				suiClient,
				keypair,
				ORIGINAL_PUBLICATION_ADDRESS,
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
	.requiredOption("--id <id>", "Sui ID of the publication")
	.action(async (options) => {
		try {
			const publications = await listPublications(
				suiClient,
				keypair,
				ORIGINAL_PUBLICATION_ADDRESS,
			);
			const entry = publications.find((p) => p.id === options.id);
			if (!entry)
				die(`Publication ${options.id} not found or you don't own it`);

			process.stderr.write(`Deleting "${entry.name}"...\n`);
			const { digest, name } = await deletePublication(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.id,
				entry.capId,
			);
			console.log(`Deleted "${name}". (tx: ${digest})`);
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

const col = pub
	.command("collection")
	.description("Manage collections within a publication");

col
	.command("add")
	.description("Add a collection to a publication")
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--name <name>", "Collection name")
	.action(async (options) => {
		try {
			process.stderr.write(`Adding collection "${options.name}"...\n`);
			const digest = await addCollection(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
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
	.requiredOption("--publication-id <id>", "Publication ID")
	.action(async (options) => {
		try {
			const collections = await listCollections(
				suiClient,
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
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--name <name>", "Collection name")
	.action(async (options) => {
		try {
			process.stderr.write(`Deleting collection "${options.name}"...\n`);
			const digest = await deleteCollection(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.publicationId,
				options.name,
			);
			console.log(`Deleted collection "${options.name}". (tx: ${digest})`);
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

const ent = pub
	.command("entry")
	.description("Manage entries within a collection");

ent
	.command("add")
	.description("Add an entry to a collection")
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--collection <name>", "Collection name")
	.requiredOption("--name <name>", "Entry name")
	.option("--entry-type <mime>", "MIME type", "application/octet-stream")
	.option("--path <file>", "Path to local file to upload")
	.option("--raw <content>", "Raw content string to upload")
	.action(async (options) => {
		try {
			if (!options.path && !options.raw) die("Provide --path or --raw");
			if (options.path && options.raw)
				die("--path and --raw are mutually exclusive");

			const content = options.path
				? await Bun.file(options.path).bytes()
				: new TextEncoder().encode(options.raw);

			const { totalCost: walCostMist } = await suiClient.walrus.storageCost(
				content.length,
				3,
			);

			process.stderr.write(`Uploading to Walrus...\n`);
			const { blobObject } = await suiClient.walrus.writeBlob({
				blob: content,
				deletable: true,
				epochs: 3,
				signer: keypair,
			});

			process.stderr.write(
				`Adding entry "${options.name}" to "${options.collection}"...\n`,
			);
			const receipt = await addEntry(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.publicationId,
				options.collection,
				options.name,
				options.entryType,
				blobObject.id,
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
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--collection <name>", "Collection name")
	.requiredOption("--index <n>", "Entry index", parseInt)
	.action(async (options) => {
		try {
			const entries = await listEntries(
				suiClient,
				options.publicationId,
				options.collection,
			);
			const entry = entries.find((e) => e.index === options.index);
			if (!entry) die(`No entry at index ${options.index}`);

			process.stderr.write(
				`${entry.index}  ${entry.name}  ${entry.entryType}  ${entry.blob}\n`,
			);

			const blobObj = await suiClient.getObject({
				objectId: entry.blob,
				include: { json: true },
			});
			const blobJson = blobObj.object.json as {
				blob_id: string;
				storage: { end_epoch: number };
			};

			const {
				committee: { epoch: currentEpoch },
			} = await suiClient.walrus.systemState();
			if (Number(currentEpoch) >= Number(blobJson.storage.end_epoch)) {
				console.log(
					`Blob expired at epoch ${blobJson.storage.end_epoch} (current: ${currentEpoch})`,
				);
				return;
			}

			const walrusBlobId = blobIdFromInt(BigInt(blobJson.blob_id));
			process.stderr.write(`Fetching from Walrus...\n`);
			const bytes = await suiClient.walrus.readBlob({ blobId: walrusBlobId });
			process.stdout.write(new TextDecoder().decode(bytes));
			process.stdout.write("\n");
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

ent
	.command("list")
	.description("List entries in a collection")
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--collection <name>", "Collection name")
	.action(async (options) => {
		try {
			const entries = await listEntries(
				suiClient,
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
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--collection <name>", "Collection name")
	.requiredOption("--index <n>", "Entry index", parseInt)
	.action(async (options) => {
		try {
			process.stderr.write(
				`Deleting entry at index ${options.index} from "${options.collection}"...\n`,
			);
			const digest = await deleteEntry(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.publicationId,
				options.collection,
				options.index,
			);
			console.log(`Deleted entry at index ${options.index}. (tx: ${digest})`);
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

const sing = pub
	.command("singleton")
	.description("Manage singletons within a publication");

sing
	.command("add")
	.description("Add a singleton to a publication")
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--name <name>", "Singleton name")
	.option("--entry-type <mime>", "MIME type", "application/octet-stream")
	.option("--path <file>", "Path to local file to upload")
	.option("--raw <content>", "Raw content string to upload")
	.action(async (options) => {
		try {
			if (!options.path && !options.raw) die("Provide --path or --raw");
			if (options.path && options.raw)
				die("--path and --raw are mutually exclusive");

			const content = options.path
				? await Bun.file(options.path).bytes()
				: new TextEncoder().encode(options.raw);

			process.stderr.write(`Uploading to Walrus...\n`);
			const { blobObject } = await suiClient.walrus.writeBlob({
				blob: content,
				deletable: true,
				epochs: 3,
				signer: keypair,
			});

			process.stderr.write(`Adding singleton "${options.name}"...\n`);
			const digest = await addSingleton(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.publicationId,
				options.name,
				options.entryType,
				blobObject.id,
			);
			console.log(`Added singleton "${options.name}". (tx: ${digest})`);
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

sing
	.command("list")
	.description("List singletons in a publication")
	.requiredOption("--publication-id <id>", "Publication ID")
	.action(async (options) => {
		try {
			const singletons = await listSingletons(suiClient, options.publicationId);
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
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--name <name>", "Singleton name")
	.action(async (options) => {
		try {
			const singletons = await listSingletons(suiClient, options.publicationId);
			const singleton = singletons.find((s) => s.name === options.name);
			if (!singleton) die(`No singleton named "${options.name}"`);

			process.stderr.write(
				`${singleton.name}  ${singleton.entryType}  ${singleton.blob}\n`,
			);

			const blobObj = await suiClient.getObject({
				objectId: singleton.blob,
				include: { json: true },
			});
			const blobJson = blobObj.object.json as {
				blob_id: string;
				storage: { end_epoch: number };
			};

			const {
				committee: { epoch: currentEpoch },
			} = await suiClient.walrus.systemState();
			if (Number(currentEpoch) >= Number(blobJson.storage.end_epoch)) {
				console.log(
					`Blob expired at epoch ${blobJson.storage.end_epoch} (current: ${currentEpoch})`,
				);
				return;
			}

			const walrusBlobId = blobIdFromInt(BigInt(blobJson.blob_id));
			process.stderr.write(`Fetching from Walrus...\n`);
			const bytes = await suiClient.walrus.readBlob({ blobId: walrusBlobId });
			process.stdout.write(new TextDecoder().decode(bytes));
			process.stdout.write("\n");
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

sing
	.command("delete")
	.description("Delete a singleton from a publication")
	.requiredOption("--publication-id <id>", "Publication ID")
	.requiredOption("--name <name>", "Singleton name")
	.action(async (options) => {
		try {
			process.stderr.write(`Deleting singleton "${options.name}"...\n`);
			const digest = await deleteSingleton(
				suiClient,
				keypair,
				PUBLICATION_ADDRESS,
				options.publicationId,
				options.name,
			);
			console.log(`Deleted singleton "${options.name}". (tx: ${digest})`);
		} catch (e) {
			die(e instanceof Error ? e.message : String(e));
		}
	});

program.parse();
