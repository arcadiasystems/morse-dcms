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
    console.log("Creating publication with name:", options.name);
    const digest = await createPublication(suiClient, keypair, PUBLICATION_ADDRESS, options.name);
    console.log("Created. Transaction digest:", digest);
  });

pub
  .command("get")
  .description("Get a single publication")
  .requiredOption("--id <id>", "Sui ID of the publication")
  .action(async (options) => {
    console.log("Fetching publication with id:", options.id);
    const publication = await getPublication(suiClient, options.id);
    console.log(JSON.stringify(publication, null, 2));
  });

pub
  .command("list")
  .description("List all publications")
  .action(async () => {
    console.log("Listing all publications");
    const publications = await listPublications(suiClient, keypair, ORIGINAL_PUBLICATION_ADDRESS);
    for (const pub of publications) {
      console.log(`${pub.id}  ${pub.name}`);
    }
  });

pub
  .command("delete")
  .description("Delete a publication")
  .requiredOption("--id <id>", "Sui ID of the publication")
  .action(async (options) => {
    console.log("Deleting publication with id:", options.id);
    const digest = await deletePublication(suiClient, keypair, PUBLICATION_ADDRESS, options.id);
    console.log("Deleted. Transaction digest:", digest);
  });

program.parse();
