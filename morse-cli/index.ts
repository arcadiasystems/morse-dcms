#!/usr/bin/env bun

import "dotenv/config";
import { Command } from "commander";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  createPublication,
  listPublications,
  getPublication,
  deletePublication,
  addCollection,
  deleteCollection,
  listCollections,
  addEntry,
  deleteEntry,
  listEntries,
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
});

function die(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function randomBlobId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// TODO: replace with real Walrus upload
async function uploadToWalrus(_content: Uint8Array): Promise<string> {
  return randomBlobId();
}

function vecMapKeys(v: unknown): string {
  const contents = (v as { contents?: { key: unknown }[] } | undefined)?.contents;
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
      const digest = await createPublication(suiClient, keypair, PUBLICATION_ADDRESS, options.name);
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
        const p = publication as { id?: string; name?: string; collections?: unknown; singletons?: unknown };
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
      const publications = await listPublications(suiClient, keypair, ORIGINAL_PUBLICATION_ADDRESS);
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
      const publications = await listPublications(suiClient, keypair, ORIGINAL_PUBLICATION_ADDRESS);
      const entry = publications.find((p) => p.id === options.id);
      if (!entry) die(`Publication ${options.id} not found or you don't own it`);

      process.stderr.write(`Deleting "${entry.name}"...\n`);
      const { digest, name } = await deletePublication(suiClient, keypair, PUBLICATION_ADDRESS, options.id, entry.capId);
      console.log(`Deleted "${name}". (tx: ${digest})`);
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

const col = pub.command("collection").description("Manage collections within a publication");

col
  .command("add")
  .description("Add a collection to a publication")
  .requiredOption("--publication-id <id>", "Publication ID")
  .requiredOption("--name <name>", "Collection name")
  .action(async (options) => {
    try {
      process.stderr.write(`Adding collection "${options.name}"...\n`);
      const digest = await addCollection(suiClient, keypair, PUBLICATION_ADDRESS, options.publicationId, options.name);
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
      const collections = await listCollections(suiClient, options.publicationId);
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
      const digest = await deleteCollection(suiClient, keypair, PUBLICATION_ADDRESS, options.publicationId, options.name);
      console.log(`Deleted collection "${options.name}". (tx: ${digest})`);
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

const ent = pub.command("entry").description("Manage entries within a collection");

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
      if (options.path && options.raw) die("--path and --raw are mutually exclusive");

      const blobId = options.path
        ? await uploadToWalrus(await Bun.file(options.path).bytes())
        : await uploadToWalrus(new TextEncoder().encode(options.raw));

      process.stderr.write(`Adding entry "${options.name}" to "${options.collection}"...\n`);
      const digest = await addEntry(suiClient, keypair, PUBLICATION_ADDRESS, options.publicationId, options.collection, options.name, options.entryType, blobId);
      console.log(`Added entry "${options.name}". (tx: ${digest})`);
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
      const entries = await listEntries(suiClient, options.publicationId, options.collection);
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
      process.stderr.write(`Deleting entry at index ${options.index} from "${options.collection}"...\n`);
      const digest = await deleteEntry(suiClient, keypair, PUBLICATION_ADDRESS, options.publicationId, options.collection, options.index);
      console.log(`Deleted entry at index ${options.index}. (tx: ${digest})`);
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

program.parse();
