#!/usr/bin/env bun
/**
 * Phase 8 smoke: exercise the allowlist module end-to-end on testnet.
 * Creates an allowlist, adds a member, queries reader, removes the member,
 * and deletes the allowlist. Costs real testnet SUI gas.
 *
 * Required env vars:
 *   PRIVATE_KEY    - suiprivkey1... bech32 secret key
 * Optional:
 *   SUI_RPC_URL    - override the default testnet RPC URL
 *   MEMBER_ADDRESS - address to add as a member (defaults to a stable
 *                    constant unrelated to the sender)
 */

import {
	addMember,
	createAllowlist,
	deleteAllowlist,
	RpcFilesReader,
	removeMember,
	toSuiAddress,
} from "../src/index.js";
import { buildSmokeContext, done, formatMist, step } from "./_shared.js";

const DEFAULT_MEMBER = toSuiAddress(
	"0x000000000000000000000000000000000000000000000000000000000000aaaa",
);

async function main(): Promise<void> {
	const ctx = buildSmokeContext();
	const filesReader = RpcFilesReader.fromMorseConfig(ctx.config, ctx.client);
	const memberEnv = process.env.MEMBER_ADDRESS;
	const memberAddress = memberEnv ? toSuiAddress(memberEnv) : DEFAULT_MEMBER;
	const name = `smoke-allowlist-${Date.now()}`;

	console.log(`Phase 8: allowlist smoke against testnet`);
	console.log(`  sender:  ${ctx.adapter.address}`);
	console.log(`  member:  ${memberAddress}`);
	console.log(`  name:    ${name}`);
	console.log();

	const total = 6;

	step(1, total, "createAllowlist");
	const created = await createAllowlist(ctx.adapter, ctx.config, { name });
	const { allowlistId, capId } = created;
	done(`allowlist=${allowlistId}`);
	done(`cap=${capId}`);
	done(`gas=${formatMist(created.gasUsedMist)}`);

	step(2, total, "addMember");
	const addRes = await addMember(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
		member: memberAddress,
	});
	done(`digest=${addRes.digest}, gas=${formatMist(addRes.gasUsedMist)}`);

	step(3, total, "reader.getAllowlist");
	const allowlist = await filesReader.getAllowlist(allowlistId);
	done(`name=${allowlist.name}`);
	done(`members=${allowlist.members.length} [${allowlist.members.join(", ")}]`);
	if (!allowlist.members.includes(memberAddress)) {
		throw new Error(
			`expected member ${memberAddress} to be present after addMember; got ${JSON.stringify(allowlist.members)}`,
		);
	}

	step(4, total, "reader.listAllowlistCapsOwnedBy(sender)");
	const ownedCaps = await filesReader.listAllowlistCapsOwnedBy(
		ctx.adapter.address,
	);
	const ownsThisCap = ownedCaps.results.some(
		(c) => (c.id as unknown as string) === (capId as unknown as string),
	);
	done(`owned caps: ${ownedCaps.results.length}`);
	if (!ownsThisCap) {
		throw new Error(
			`expected sender to own newly-created cap ${capId}; got [${ownedCaps.results.map((c) => c.id).join(", ")}]`,
		);
	}

	step(5, total, "removeMember");
	const rmRes = await removeMember(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
		member: memberAddress,
	});
	done(`digest=${rmRes.digest}, gas=${formatMist(rmRes.gasUsedMist)}`);

	step(6, total, "deleteAllowlist");
	const delRes = await deleteAllowlist(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
	});
	done(`digest=${delRes.digest}, gas=${formatMist(delRes.gasUsedMist)}`);

	console.log("\nPhase 8 OK");
}

main().catch((error) => {
	console.error("\nPhase 8 FAILED:", error);
	process.exit(1);
});
