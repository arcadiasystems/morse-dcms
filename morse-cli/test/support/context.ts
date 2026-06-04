/**
 * In-process context fixtures. Build a ReadContext/WriteContext/... backed by a
 * mock reader and a capturing Output, with no SDK clients or network. SDK write
 * ops are intercepted separately (see sdk-mock.ts); the client/adapter/keypair
 * fields are inert stand-ins the mocked ops never dereference. Walrus and Seal
 * adapters are injectable for the content paths that call them directly.
 */

import {
	morseConfig,
	type NetworkConfig,
	type RpcPublicationReader,
	type SuiAddress,
	toSuiAddress,
} from "@arcadiasystems/morse-sdk";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import type {
	AllowlistWriteContext,
	ContentContext,
	DecryptContext,
	EncryptContext,
	FileDownloadContext,
	FilesReadContext,
	ReadContentContext,
	ReadContext,
	WriteContext,
} from "../../src/cli/context.ts";
import type { Output } from "../../src/cli/output.ts";
import type { ResolvedSettings } from "../../src/config/profile.ts";
import { type CapturedOutput, captureOutput } from "./output.ts";

export const ADDRESS = toSuiAddress(`0x${"a".repeat(64)}`);
export const PUBLICATION_ID = `0x${"b".repeat(64)}`;

export type MockReader = Partial<RpcPublicationReader>;

const inert = <T>(): T => ({}) as unknown as T;

function baseSettings(over: Partial<ResolvedSettings> = {}): ResolvedSettings {
	return { profileName: "default", network: "testnet", ...over };
}

export interface ReadFixtureOptions {
	readonly reader?: MockReader;
	// Loosely typed: tests supply only the RpcFilesReader methods the core calls.
	readonly filesReader?: unknown;
	readonly settings?: Partial<ResolvedSettings>;
	readonly ownerAddress?: SuiAddress | undefined;
	readonly json?: boolean;
	readonly quiet?: boolean;
}

export interface ReadFixture {
	readonly ctx: ReadContext;
	readonly captured: CapturedOutput;
}

function config(): NetworkConfig {
	return morseConfig({ network: "testnet" });
}

function readBase(opts: ReadFixtureOptions): {
	ctx: ReadContext;
	captured: CapturedOutput;
	output: Output;
} {
	const captured = captureOutput({ json: opts.json, quiet: opts.quiet });
	const ctx: ReadContext = {
		output: captured.output,
		settings: baseSettings(opts.settings),
		config: config(),
		client: inert<SuiGrpcClient>(),
		reader: (opts.reader ?? {}) as unknown as RpcPublicationReader,
		ownerAddress: "ownerAddress" in opts ? opts.ownerAddress : ADDRESS,
		signal: new AbortController().signal,
	};
	return { ctx, captured, output: captured.output };
}

export function readContext(opts: ReadFixtureOptions = {}): ReadFixture {
	const { ctx, captured } = readBase(opts);
	return { ctx, captured };
}

export interface WriteFixture {
	readonly ctx: WriteContext;
	readonly captured: CapturedOutput;
}

export function writeContext(opts: ReadFixtureOptions = {}): WriteFixture {
	const { ctx, captured } = readBase(opts);
	return {
		ctx: {
			...ctx,
			adapter: inert<WriteContext["adapter"]>(),
			address: ADDRESS,
		},
		captured,
	};
}

function filesReaderOf(
	opts: ReadFixtureOptions,
): FilesReadContext["filesReader"] {
	return (opts.filesReader ?? {}) as FilesReadContext["filesReader"];
}

export function filesReadContext(opts: ReadFixtureOptions = {}): {
	ctx: FilesReadContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = readBase(opts);
	return { ctx: { ...ctx, filesReader: filesReaderOf(opts) }, captured };
}

export function allowlistWriteContext(opts: ReadFixtureOptions = {}): {
	ctx: AllowlistWriteContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = writeContext(opts);
	return { ctx: { ...ctx, filesReader: filesReaderOf(opts) }, captured };
}

export interface DownloadFixtureOptions extends ReadFixtureOptions {
	readonly walrusRead?: unknown;
	readonly seal?: unknown;
}

export function fileDownloadContext(opts: DownloadFixtureOptions = {}): {
	ctx: FileDownloadContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = filesReadContext(opts);
	return {
		ctx: {
			...ctx,
			walrusRead: (opts.walrusRead ??
				{}) as unknown as FileDownloadContext["walrusRead"],
			seal: (opts.seal ?? {}) as unknown as FileDownloadContext["seal"],
			// Encrypted-decrypt tests live in the live e2e; hermetic guard tests
			// never reach the signer, so fail loudly if one does.
			unlockSigner: () =>
				Promise.reject(new Error("unlockSigner should not be called")),
		},
		captured,
	};
}

export interface ContentFixtureOptions extends ReadFixtureOptions {
	// Loosely typed: tests supply only the methods the core under test calls.
	readonly walrus?: unknown;
}

export interface ContentFixture {
	readonly ctx: ContentContext;
	readonly captured: CapturedOutput;
}

export function contentContext(
	opts: ContentFixtureOptions = {},
): ContentFixture {
	const { ctx, captured } = writeContext(opts);
	return {
		ctx: {
			...ctx,
			walrus: (opts.walrus ?? {}) as unknown as ContentContext["walrus"],
		},
		captured,
	};
}

export interface EncryptFixtureOptions extends ContentFixtureOptions {
	readonly seal?: unknown;
}

export function encryptContext(opts: EncryptFixtureOptions = {}): {
	ctx: EncryptContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = contentContext(opts);
	return {
		ctx: {
			...ctx,
			seal: (opts.seal ?? {}) as unknown as EncryptContext["seal"],
		},
		captured,
	};
}

export interface ReadContentFixtureOptions extends ReadFixtureOptions {
	readonly walrusRead?: unknown;
}

export function readContentContext(opts: ReadContentFixtureOptions = {}): {
	ctx: ReadContentContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = readBase(opts);
	return {
		ctx: {
			...ctx,
			walrusRead: (opts.walrusRead ??
				{}) as unknown as ReadContentContext["walrusRead"],
		},
		captured,
	};
}

export interface DecryptFixtureOptions extends ReadContentFixtureOptions {
	readonly seal?: unknown;
}

export function decryptContext(opts: DecryptFixtureOptions = {}): {
	ctx: DecryptContext;
	captured: CapturedOutput;
} {
	const { ctx, captured } = readContentContext(opts);
	return {
		ctx: {
			...ctx,
			keypair: inert<Ed25519Keypair>(),
			address: ADDRESS,
			seal: (opts.seal ?? {}) as unknown as DecryptContext["seal"],
		},
		captured,
	};
}
