import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

export type TransactionExecutor = Pick<SuiGrpcClient, "signAndExecuteTransaction" | "waitForTransaction">;
export type ObjectFetcher = Pick<SuiGrpcClient, "getObject" | "listOwnedObjects">;
export type PublicationDeleter = TransactionExecutor & Pick<ObjectFetcher, "getObject">;

export async function createPublication(
  client: TransactionExecutor,
  signer: Ed25519Keypair,
  publicationAddress: string,
  name: string,
): Promise<string> {
  const tx = new Transaction();

  tx.moveCall({
    target: `${publicationAddress}::publication::new_publication`,
    arguments: [tx.pure.string(name)],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
  });

  if (result.$kind === "FailedTransaction") {
    throw new Error(
      `Transaction failed: ${result.FailedTransaction.status.error?.message}`,
    );
  }

  const waitResult = await client.waitForTransaction({ result });
  return waitResult.Transaction?.digest ?? "";
}

export async function listPublications(
  client: ObjectFetcher,
  signer: Ed25519Keypair,
  originalPublicationAddress: string,
): Promise<Array<{ id: string; name: string; capId: string }>> {
  const caps = await client.listOwnedObjects({
    owner: signer.getPublicKey().toSuiAddress(),
    type: `${originalPublicationAddress}::publication::OwnerCap`,
    include: { json: true },
  });

  const publications = await Promise.all(
    caps.objects.map((cap) =>
      client.getObject({
        objectId: (cap.json as { publication_id: string }).publication_id,
        include: { json: true },
      })
    )
  );

  return publications.map((pub, i) => ({
    id: pub.object.objectId,
    name: (pub.object.json as { name: string } | undefined)?.name ?? "(unknown)",
    capId: caps.objects[i]!.objectId,
  }));
}

export async function getPublication(
  client: ObjectFetcher,
  id: string,
): Promise<object> {
  const publication = await client.getObject({
    objectId: id,
    include: { json: true },
  });
  return publication.object.json as object;
}

export async function deletePublication(
  client: PublicationDeleter,
  signer: Ed25519Keypair,
  publicationAddress: string,
  id: string,
  capId: string,
): Promise<{ digest: string; name: string }> {
  const publication = await client.getObject({
    objectId: id,
    include: { json: true },
  });
  const name = (publication.object.json as { name: string } | undefined)?.name ?? id;

  const tx = new Transaction();

  tx.moveCall({
    target: `${publicationAddress}::publication::delete_publication`,
    arguments: [tx.object(id), tx.object(capId)],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
  });

  if (result.$kind === "FailedTransaction") {
    throw new Error(
      `Transaction failed: ${result.FailedTransaction.status.error?.message}`,
    );
  }

  const waitResult = await client.waitForTransaction({ result });
  return { digest: waitResult.Transaction?.digest ?? "", name };
}
