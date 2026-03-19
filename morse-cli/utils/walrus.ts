import { blobIdFromInt } from "@mysten/walrus";
import type { AppContext } from "../context.ts";

export async function uploadBlob(
	ctx: AppContext,
	content: Uint8Array,
): Promise<{ blobObjectId: string; walCostMist: bigint }> {
	const { totalCost: walCostMist } = await ctx.suiClient.walrus.storageCost(
		content.length,
		3,
	);
	process.stderr.write("Uploading to Walrus...\n");
	const { blobObject } = await ctx.suiClient.walrus.writeBlob({
		blob: content,
		deletable: true,
		epochs: 3,
		signer: ctx.keypair,
	});
	return { blobObjectId: blobObject.id, walCostMist };
}

export async function readBlob(
	ctx: AppContext,
	blobObjectId: string,
): Promise<void> {
	const blobObj = await ctx.suiClient.getObject({
		objectId: blobObjectId,
		include: { json: true },
	});
	const blobJson = blobObj.object.json as {
		blob_id: string;
		storage: { end_epoch: number };
	};

	const {
		committee: { epoch: currentEpoch },
	} = await ctx.suiClient.walrus.systemState();
	if (Number(currentEpoch) >= Number(blobJson.storage.end_epoch)) {
		console.log(
			`Blob expired at epoch ${blobJson.storage.end_epoch} (current: ${currentEpoch})`,
		);
		return;
	}

	const walrusBlobId = blobIdFromInt(BigInt(blobJson.blob_id));
	process.stderr.write("Fetching from Walrus...\n");
	const bytes = await ctx.suiClient.walrus.readBlob({ blobId: walrusBlobId });
	process.stdout.write(new TextDecoder().decode(bytes));
	process.stdout.write("\n");
}
