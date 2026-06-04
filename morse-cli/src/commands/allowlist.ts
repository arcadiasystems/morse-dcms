/** `morse allowlist`: per-wallet allowlists that gate decryption of encrypted files. */

import {
	type AllowlistId,
	addMember,
	createAllowlist,
	deleteAllowlist,
	removeMember,
	toAllowlistId,
	toSuiAddress,
	transferAllowlistCap,
} from "@arcadiasystems/morse-sdk";
import type { Command } from "commander";

import {
	type AllowlistWriteContext,
	buildAllowlistWriteContext,
	buildFilesReadContext,
	buildWriteContext,
	type FilesReadContext,
	type WriteContext,
} from "../cli/context.ts";
import { cancelled, UsageError } from "../cli/errors.ts";
import type { GlobalOptions } from "../cli/program.ts";
import { confirm } from "../cli/prompts.ts";
import { globalOptions } from "../cli/runtime.ts";
import { shortId } from "../format/ids.ts";
import { renderAllowlist, renderAllowlistCapList } from "../format/render.ts";
import { allowlistCapOption, allowlistOption } from "./options.ts";
import { resolveAllowlistCap } from "./resolve.ts";
import { parseLimit } from "./shared.ts";

interface CapTargetOptions {
	readonly allowlist?: string;
	readonly cap?: string;
}

function requireAllowlistId(value: string | undefined): AllowlistId {
	if (value === undefined) {
		throw new UsageError("Pass --allowlist <id>.");
	}
	return toAllowlistId(value);
}

export async function runAllowlistCreate(
	ctx: WriteContext,
	options: { name: string },
): Promise<void> {
	ctx.output.info(`Creating allowlist "${options.name}"...`);
	const result = await createAllowlist(ctx.adapter, ctx.config, {
		name: options.name,
		signal: ctx.signal,
	});
	const human = [
		`Created allowlist "${options.name}" (${result.allowlistId})`,
		`  cap: ${result.capId}`,
		`  tx:  ${result.digest}`,
		"Save the cap id: it is the admin token for managing members.",
	].join("\n");
	ctx.output.result(human, result);
}

export async function runAllowlistAddMember(
	ctx: AllowlistWriteContext,
	member: string,
	options: CapTargetOptions,
): Promise<void> {
	const allowlistId = requireAllowlistId(options.allowlist);
	const memberAddress = toSuiAddress(member);
	const capId = await resolveAllowlistCap(
		ctx.filesReader,
		ctx.address,
		allowlistId,
		options.cap,
		ctx.signal,
	);
	const result = await addMember(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
		member: memberAddress,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Added ${memberAddress} to allowlist ${shortId(allowlistId)}. (tx: ${result.digest})`,
		result,
	);
}

export async function runAllowlistRemoveMember(
	ctx: AllowlistWriteContext,
	member: string,
	options: CapTargetOptions,
): Promise<void> {
	const allowlistId = requireAllowlistId(options.allowlist);
	const memberAddress = toSuiAddress(member);
	const capId = await resolveAllowlistCap(
		ctx.filesReader,
		ctx.address,
		allowlistId,
		options.cap,
		ctx.signal,
	);
	const result = await removeMember(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
		member: memberAddress,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Removed ${memberAddress} from allowlist ${shortId(allowlistId)}. (tx: ${result.digest})`,
		result,
	);
}

export async function runAllowlistTransferCap(
	ctx: AllowlistWriteContext,
	recipient: string,
	options: CapTargetOptions,
	gopts: GlobalOptions,
): Promise<void> {
	const allowlistId = requireAllowlistId(options.allowlist);
	const to = toSuiAddress(recipient);
	const proceed = await confirm(
		`Transfer admin of allowlist ${shortId(allowlistId)} to ${to}? You will lose member-management rights.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	ctx.output.info("Resolving allowlist Cap...");
	const capId = await resolveAllowlistCap(
		ctx.filesReader,
		ctx.address,
		allowlistId,
		options.cap,
		ctx.signal,
	);
	const result = await transferAllowlistCap(ctx.adapter, ctx.config, {
		capId,
		recipient: to,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Transferred allowlist admin to ${to}. (tx: ${result.digest})`,
		result,
	);
}

export async function runAllowlistDelete(
	ctx: AllowlistWriteContext,
	options: CapTargetOptions,
	gopts: GlobalOptions,
): Promise<void> {
	const allowlistId = requireAllowlistId(options.allowlist);
	const proceed = await confirm(
		`Delete allowlist ${shortId(allowlistId)}? Files gated by it become permanently undecryptable.`,
		{ assumeYes: Boolean(gopts.yes), signal: ctx.signal },
	);
	if (!proceed) {
		cancelled();
	}
	ctx.output.info("Resolving allowlist Cap...");
	const capId = await resolveAllowlistCap(
		ctx.filesReader,
		ctx.address,
		allowlistId,
		options.cap,
		ctx.signal,
	);
	const result = await deleteAllowlist(ctx.adapter, ctx.config, {
		allowlistId,
		capId,
		signal: ctx.signal,
	});
	ctx.output.result(
		`Deleted allowlist ${allowlistId}. (tx: ${result.digest})`,
		result,
	);
}

export async function runAllowlistGet(
	ctx: FilesReadContext,
	target: string,
): Promise<void> {
	const result = await ctx.filesReader.getAllowlist(
		toAllowlistId(target),
		ctx.signal,
	);
	ctx.output.result(renderAllowlist(result), result);
}

export async function runAllowlistListCaps(
	ctx: FilesReadContext,
	address: string | undefined,
	options: { limit?: string; cursor?: string },
): Promise<void> {
	const holder =
		address === undefined ? ctx.ownerAddress : toSuiAddress(address);
	if (holder === undefined) {
		throw new UsageError(
			"No address given and no active account. Pass an address or import an account.",
		);
	}
	const page = await ctx.filesReader.listAllowlistCapsOwnedBy(holder, {
		signal: ctx.signal,
		...(options.limit === undefined
			? {}
			: { limit: parseLimit(options.limit) }),
		...(options.cursor === undefined ? {} : { cursor: options.cursor }),
	});
	if (page.nextCursor !== null) {
		ctx.output.info(`More results: pass --cursor "${page.nextCursor}"`);
	}
	ctx.output.result(renderAllowlistCapList(page.results), {
		results: page.results,
		nextCursor: page.nextCursor,
	});
}

export function registerAllowlistCommands(program: Command): void {
	const allowlist = program
		.command("allowlist")
		.description("Manage allowlists that gate decryption of encrypted files");

	allowlist
		.command("create")
		.description("Create an allowlist and transfer its admin cap to you")
		.requiredOption("-n, --name <name>", "Allowlist name")
		.action(async (options: { name: string }, command: Command) => {
			await runAllowlistCreate(await buildWriteContext(command), options);
		});

	const addMemberCmd = allowlist
		.command("add-member <member>")
		.description("Add a wallet address to an allowlist");
	allowlistCapOption(allowlistOption(addMemberCmd)).action(
		async (member: string, options: CapTargetOptions, command: Command) => {
			await runAllowlistAddMember(
				await buildAllowlistWriteContext(command),
				member,
				options,
			);
		},
	);

	const removeMemberCmd = allowlist
		.command("remove-member <member>")
		.description("Remove a wallet address from an allowlist");
	allowlistCapOption(allowlistOption(removeMemberCmd)).action(
		async (member: string, options: CapTargetOptions, command: Command) => {
			await runAllowlistRemoveMember(
				await buildAllowlistWriteContext(command),
				member,
				options,
			);
		},
	);

	const transferCmd = allowlist
		.command("transfer-cap <recipient>")
		.description("Transfer allowlist admin rights to another address");
	allowlistCapOption(allowlistOption(transferCmd)).action(
		async (recipient: string, options: CapTargetOptions, command: Command) => {
			await runAllowlistTransferCap(
				await buildAllowlistWriteContext(command),
				recipient,
				options,
				globalOptions(command),
			);
		},
	);

	const deleteCmd = allowlist
		.command("delete")
		.description("Delete an allowlist (dependent files become undecryptable)");
	allowlistCapOption(allowlistOption(deleteCmd)).action(
		async (options: CapTargetOptions, command: Command) => {
			await runAllowlistDelete(
				await buildAllowlistWriteContext(command),
				options,
				globalOptions(command),
			);
		},
	);

	allowlist
		.command("get <allowlist>")
		.description("Fetch an allowlist's name and members")
		.action(async (target: string, _options, command: Command) => {
			await runAllowlistGet(await buildFilesReadContext(command), target);
		});

	allowlist
		.command("list-caps [address]")
		.description(
			"List allowlist admin caps held by an address (default: the active account)",
		)
		.option("--limit <n>", "Maximum results per page")
		.option("--cursor <cursor>", "Continue from a previous page cursor")
		.action(
			async (
				address: string | undefined,
				options: { limit?: string; cursor?: string },
				command: Command,
			) => {
				await runAllowlistListCaps(
					await buildFilesReadContext(command),
					address,
					options,
				);
			},
		);
}
