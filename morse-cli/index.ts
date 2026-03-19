#!/usr/bin/env bun

import "dotenv/config";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Command } from "commander";
import { addAssetCommands } from "./commands/asset.ts";
import { addCollectionCommands } from "./commands/collection.ts";
import { addEntryCommands } from "./commands/entry.ts";
import { addPublicationCommands } from "./commands/publication.ts";
import { addSingletonCommands } from "./commands/singleton.ts";
import { type AppContext, createSuiClient } from "./context.ts";

const ctx: AppContext = {
	suiClient: createSuiClient(process.env.SUI_RPC_URL || ""),
	keypair: Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY || ""),
	publicationAddress: process.env.PUBLICATION_ADDRESS || "",
	originalPublicationAddress: process.env.ORIGINAL_PUBLICATION_ADDRESS || "",
};

const program = new Command()
	.name("morse")
	.description("CLI for working with Morse publications")
	.version("0.0.1");

const pub = program.command("pub").description("Manage publications");

addPublicationCommands(pub, ctx);
addCollectionCommands(pub, ctx);
addEntryCommands(pub, ctx);
addSingletonCommands(pub, ctx);
addAssetCommands(pub, ctx);

await program.parseAsync();
