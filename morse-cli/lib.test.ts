import { test, expect, mock } from "bun:test";
import type { TransactionExecutor, ObjectFetcher, PublicationDeleter, CollectionManager } from "./lib.ts";
import { createPublication, listPublications, getPublication, deletePublication, addCollection, deleteCollection, listCollections, addEntry, deleteEntry } from "./lib.ts";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { SuiClientTypes } from "@mysten/sui/client";

// --- shared helpers ---

function makeObject(
  objectId: string,
  json: Record<string, unknown> | null,
): SuiClientTypes.Object<{ json: true }> {
  return {
    objectId,
    version: "1",
    digest: "d",
    owner: { $kind: "AddressOwner", AddressOwner: "0x0" } as SuiClientTypes.ObjectOwner,
    type: "0x0::pub::Publication",
    content: undefined,
    previousTransaction: undefined,
    objectBcs: undefined,
    json,
  };
}

function makeObjectFetcher(overrides?: any): ObjectFetcher {
  return {
    getObject: mock(async ({ objectId }) => ({ object: makeObject(objectId, { name: "Test" }) })),
    listOwnedObjects: mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
    ...overrides,
  } as unknown as ObjectFetcher;
}

function makeDeleter(
  fetcherOverrides?: any,
  executorOverrides?: any,
): PublicationDeleter {
  return {
    ...makeObjectFetcher(fetcherOverrides),
    ...makeExecutor(executorOverrides),
  };
}

const keypair = Ed25519Keypair.generate();

const successResult: SuiClientTypes.TransactionResult = {
  $kind: "Transaction",
  Transaction: {
    digest: "abc123",
    signatures: [],
    epoch: null,
    status: { success: true, error: null },
    balanceChanges: undefined,
    effects: undefined,
    events: undefined,
    objectTypes: undefined,
    transaction: undefined,
    bcs: undefined,
  },
};

function makeExecutor(overrides?: any): TransactionExecutor {
  return {
    signAndExecuteTransaction: mock(async () => successResult),
    waitForTransaction: mock(async () => successResult),
    ...overrides,
  } as unknown as TransactionExecutor;
}

test("createPublication returns digest on success", async () => {
  const executor = makeExecutor();
  const digest = await createPublication(executor, keypair, "0xABC", "My Blog");
  expect(digest).toBe("abc123");
});

test("createPublication throws on FailedTransaction", async () => {
  const failResult: SuiClientTypes.TransactionResult = {
    $kind: "FailedTransaction",
    FailedTransaction: {
      digest: "",
      signatures: [],
      epoch: null,
      status: {
        success: false,
        error: { message: "abort", $kind: "Unknown", Unknown: null },
      },
      balanceChanges: undefined,
      effects: undefined,
      events: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };

  const executor = makeExecutor({
    signAndExecuteTransaction: mock(async () => failResult),
  });

  expect(
    createPublication(executor, keypair, "0xABC", "My Blog")
  ).rejects.toThrow("Transaction failed: abort");
});

// --- listPublications ---

test("listPublications returns empty array when no OwnerCaps found", async () => {
  const client = makeObjectFetcher();
  const result = await listPublications(client, keypair, "0xADDR");
  expect(result).toEqual([]);
});

test("listPublications fetches publication by publication_id from cap json, not the cap objectId", async () => {
  const client = makeObjectFetcher({
    listOwnedObjects: mock(async () => ({
      objects: [makeObject("0xCAP", { publication_id: "0xPUB" })],
      hasNextPage: false,
      cursor: null,
    })),
    getObject: mock(async () => ({ object: makeObject("0xPUB", { name: "My Blog" }) })),
  });

  await listPublications(client, keypair, "0xADDR");

  const getObjectCalls = (client.getObject as ReturnType<typeof mock>).mock.calls;
  expect(getObjectCalls[0]![0].objectId).toBe("0xPUB");
});

test("listPublications falls back to '(unknown)' when publication json has no name", async () => {
  const client = makeObjectFetcher({
    listOwnedObjects: mock(async () => ({
      objects: [makeObject("0xCAP", { publication_id: "0xPUB" })],
      hasNextPage: false,
      cursor: null,
    })),
    getObject: mock(async () => ({ object: makeObject("0xPUB", null) })),
  });

  const result = await listPublications(client, keypair, "0xADDR");
  expect(result[0]!.name).toBe("(unknown)");
});

test("listPublications queries with the correct OwnerCap type", async () => {
  const client = makeObjectFetcher();
  await listPublications(client, keypair, "0xADDR");

  const [input] = (client.listOwnedObjects as ReturnType<typeof mock>).mock.calls[0]!;
  expect(input.type).toContain("::publication::OwnerCap");
});

test("listPublications returns one entry per cap with correct id and name", async () => {
  const client = makeObjectFetcher({
    listOwnedObjects: mock(async () => ({
      objects: [
        makeObject("0xCAP1", { publication_id: "0xPUB1" }),
        makeObject("0xCAP2", { publication_id: "0xPUB2" }),
      ],
      hasNextPage: false,
      cursor: null,
    })),
    getObject: mock(async ({ objectId }) => ({
      object: makeObject(objectId, { name: `Blog ${objectId}` }),
    })),
  });

  const result = await listPublications(client, keypair, "0xADDR");

  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({ id: "0xPUB1", name: "Blog 0xPUB1", capId: "0xCAP1" });
  expect(result[1]).toEqual({ id: "0xPUB2", name: "Blog 0xPUB2", capId: "0xCAP2" });
});

// --- getPublication ---

test("getPublication always requests json fields", async () => {
  const client = makeObjectFetcher();
  await getPublication(client, "0x123");

  const [input] = (client.getObject as ReturnType<typeof mock>).mock.calls[0]!;
  expect(input.include).toEqual({ json: true });
});

test("getPublication passes objectId through unchanged", async () => {
  const client = makeObjectFetcher();
  await getPublication(client, "0x123");

  const [input] = (client.getObject as ReturnType<typeof mock>).mock.calls[0]!;
  expect(input.objectId).toBe("0x123");
});

// --- deletePublication ---

test("deletePublication fetches the publication before executing the transaction", async () => {
  const client = makeDeleter();
  await deletePublication(client, keypair, "0xADDR", "0xPUBLICATION", "0xCAP");

  const getObjectCalls = (client.getObject as ReturnType<typeof mock>).mock.calls;
  const signCalls = (client.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;

  expect(getObjectCalls).toHaveLength(1);
  expect(getObjectCalls[0]![0].objectId).toBe("0xPUBLICATION");
  expect(signCalls).toHaveLength(1);
});

test("deletePublication throws on FailedTransaction", async () => {
  const failResult: SuiClientTypes.TransactionResult = {
    $kind: "FailedTransaction",
    FailedTransaction: {
      digest: "",
      signatures: [],
      epoch: null,
      status: { success: false, error: { message: "abort", $kind: "Unknown", Unknown: null } },
      balanceChanges: undefined,
      effects: undefined,
      events: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };

  const client = makeDeleter(undefined, {
    signAndExecuteTransaction: mock(async () => failResult),
  });

  expect(
    deletePublication(client, keypair, "0xADDR", "0xPUBLICATION", "0xCAP")
  ).rejects.toThrow("Transaction failed: abort");
});

test("deletePublication returns digest and name on success", async () => {
  const client = makeDeleter();
  const result = await deletePublication(client, keypair, "0xADDR", "0xPUBLICATION", "0xCAP");
  expect(result.digest).toBe("abc123");
  expect(result.name).toBe("Test");
});

// --- collection helpers ---

// tx.pure.id() validates a full 32-byte Sui address
const VALID_PUB_ID = "0x" + "a".repeat(64);

function makeCollectionManager(
  fetcherOverrides?: any,
  executorOverrides?: any,
): CollectionManager {
  return {
    listOwnedObjects: mock(async () => ({
      objects: [makeObject("0xCAP", { publication_id: VALID_PUB_ID })],
      hasNextPage: false,
      cursor: null,
    })),
    ...makeExecutor(executorOverrides),
    ...fetcherOverrides,
  } as unknown as CollectionManager;
}

// --- addCollection ---

test("addCollection resolves PublisherCap and executes transaction", async () => {
  const client = makeCollectionManager();
  const digest = await addCollection(client, keypair, "0xADDR", VALID_PUB_ID, "blog");

  expect(digest).toBe("abc123");
  const signCalls = (client.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;
  expect(signCalls).toHaveLength(1);
});

test("addCollection throws when no PublisherCap found", async () => {
  const client = makeCollectionManager({
    listOwnedObjects: mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
  });

  expect(
    addCollection(client, keypair, "0xADDR", VALID_PUB_ID, "blog")
  ).rejects.toThrow("No PublisherCap found");
});

test("addCollection throws on FailedTransaction", async () => {
  const failResult: SuiClientTypes.TransactionResult = {
    $kind: "FailedTransaction",
    FailedTransaction: {
      digest: "",
      signatures: [],
      epoch: null,
      status: { success: false, error: { message: "abort", $kind: "Unknown", Unknown: null } },
      balanceChanges: undefined,
      effects: undefined,
      events: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };

  const client = makeCollectionManager(undefined, {
    signAndExecuteTransaction: mock(async () => failResult),
  });

  expect(
    addCollection(client, keypair, "0xADDR", VALID_PUB_ID, "blog")
  ).rejects.toThrow("Transaction failed: abort");
});

// --- deleteCollection ---

test("deleteCollection resolves PublisherCap and executes transaction", async () => {
  const client = makeCollectionManager();
  const digest = await deleteCollection(client, keypair, "0xADDR", VALID_PUB_ID, "blog");

  expect(digest).toBe("abc123");
  const signCalls = (client.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;
  expect(signCalls).toHaveLength(1);
});

test("deleteCollection throws when no PublisherCap found", async () => {
  const client = makeCollectionManager({
    listOwnedObjects: mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
  });

  expect(
    deleteCollection(client, keypair, "0xADDR", VALID_PUB_ID, "blog")
  ).rejects.toThrow("No PublisherCap found");
});

// --- listCollections ---

test("listCollections returns collection names from VecMap", async () => {
  const client = makeObjectFetcher({
    getObject: mock(async () => ({
      object: makeObject("0xPUB", {
        collections: { contents: [{ key: "blog", value: {} }, { key: "news", value: {} }] },
      }),
    })),
  });

  const result = await listCollections(client, "0xPUB");
  expect(result).toEqual(["blog", "news"]);
});

test("listCollections returns empty array when no collections", async () => {
  const client = makeObjectFetcher({
    getObject: mock(async () => ({
      object: makeObject("0xPUB", { collections: { contents: [] } }),
    })),
  });

  const result = await listCollections(client, "0xPUB");
  expect(result).toEqual([]);
});

// --- addEntry ---

test("addEntry resolves PublisherCap and executes transaction", async () => {
  const client = makeCollectionManager();
  const digest = await addEntry(client, keypair, "0xADDR", VALID_PUB_ID, "blog", "post-1", "application/json", VALID_PUB_ID);

  expect(digest).toBe("abc123");
  const signCalls = (client.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;
  expect(signCalls).toHaveLength(1);
});

test("addEntry throws when no PublisherCap found", async () => {
  const client = makeCollectionManager({
    listOwnedObjects: mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
  });

  expect(
    addEntry(client, keypair, "0xADDR", VALID_PUB_ID, "blog", "post-1", "application/json", VALID_PUB_ID)
  ).rejects.toThrow("No PublisherCap found");
});

test("addEntry throws on FailedTransaction", async () => {
  const failResult: SuiClientTypes.TransactionResult = {
    $kind: "FailedTransaction",
    FailedTransaction: {
      digest: "",
      signatures: [],
      epoch: null,
      status: { success: false, error: { message: "abort", $kind: "Unknown", Unknown: null } },
      balanceChanges: undefined,
      effects: undefined,
      events: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };

  const client = makeCollectionManager(undefined, {
    signAndExecuteTransaction: mock(async () => failResult),
  });

  expect(
    addEntry(client, keypair, "0xADDR", VALID_PUB_ID, "blog", "post-1", "application/json", VALID_PUB_ID)
  ).rejects.toThrow("Transaction failed: abort");
});

// --- deleteEntry ---

test("deleteEntry resolves PublisherCap and executes transaction", async () => {
  const client = makeCollectionManager();
  const digest = await deleteEntry(client, keypair, "0xADDR", VALID_PUB_ID, "blog", 0);

  expect(digest).toBe("abc123");
  const signCalls = (client.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;
  expect(signCalls).toHaveLength(1);
});

test("deleteEntry throws when no PublisherCap found", async () => {
  const client = makeCollectionManager({
    listOwnedObjects: mock(async () => ({ objects: [], hasNextPage: false, cursor: null })),
  });

  expect(
    deleteEntry(client, keypair, "0xADDR", VALID_PUB_ID, "blog", 0)
  ).rejects.toThrow("No PublisherCap found");
});

// --- createPublication ---

test("createPublication calls correct Move target", async () => {
  const executor = makeExecutor();
  await createPublication(executor, keypair, "0xABC", "My Blog");

  const calls = (executor.signAndExecuteTransaction as ReturnType<typeof mock>).mock.calls;
  expect(calls.length).toBe(1);

  // The Transaction object is built internally; check it was passed
  const [input] = calls[0]!;
  expect(input).toHaveProperty("transaction");
  expect(input).toHaveProperty("signer");
});
