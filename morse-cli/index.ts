#!/usr/bin/env bun

import "dotenv/config";
import { Command } from "commander";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const keypair = Ed25519Keypair.fromSecretKey(PRIVATE_KEY);

const PUBLICATION_ADDRESS = process.env.PUBLICATION_ADDRESS || "";
const ORIGINAL_PUBLICATION_ADDRESS =
  process.env.ORIGINAL_PUBLICATION_ADDRESS || "";

const program = new Command();

const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
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
  .action(async (_options) => {
    console.log("Creating publication with name:", _options.name);

    const tx = new Transaction();

    const publication = tx.moveCall({
      package: "publication",
      module: "publication",
      function: "new_publication",
      target: `${PUBLICATION_ADDRESS}::publication::new_publication`,
      arguments: [tx.pure.string(_options.name)],
    });

    tx.transferObjects([publication], keypair.getPublicKey().toSuiAddress());

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    if (result.$kind === "FailedTransaction") {
      throw new Error(
        `Transaction failed: ${result.FailedTransaction.status.error?.message}`,
      );
    }

    const waitResult = await suiClient.waitForTransaction({
      result,
    });

    console.log(waitResult.Transaction);
  });

pub
  .command("get")
  .description("Get a single publication")
  .requiredOption("--id <id>", "Sui ID of the publication")
  .action(async (_options) => {
    console.log("Fetching publication with id:", _options.id);

    const publication = await suiClient.getObject({
      objectId: _options.id,
      include: {
        json: true, // Display the publication fields in JSON format
      },
    });

    console.log(publication);
  });

pub
  .command("list")
  .description("List all publications")
  .action(async () => {
    console.log("Listing all publications");

    const publications = await suiClient.listOwnedObjects({
      owner: keypair.getPublicKey().toSuiAddress(),
      type: `${ORIGINAL_PUBLICATION_ADDRESS}::publication::Publication`,
      include: {
        json: true,
      },
    });

    console.log(publications.objects);
  });

pub
  .command("delete")
  .description("Delete a publication")
  .requiredOption("--id <id>", "Sui ID of the publication")
  .action(async (_options) => {
    console.log("Deleting publication with id:", _options.id);

    const tx = new Transaction();

    const publication = await suiClient.getObject({
      objectId: _options.id,
      include: {
        json: true,
      },
    });

    console.log(`Deleting publication: ${publication}`);

    tx.moveCall({
      package: "publication",
      module: "publication",
      function: "delete_publication",
      target: `${PUBLICATION_ADDRESS}::publication::delete_publication`,
      arguments: [tx.object(publication.object.objectId)],
    });

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    if (result.$kind === "FailedTransaction") {
      throw new Error(
        `Transaction failed: ${result.FailedTransaction.status.error?.message}`,
      );
    }

    const waitResult = await suiClient.waitForTransaction({
      result,
    });

    console.log(waitResult.Transaction);
  });

program.parse();
