/**
 * Error boundary: map any throw to an exit code and a stderr message. SDK errors
 * are translated through `formatUserMessage`; our own `CliError` carries an
 * explicit code. Commander parse failures are handled separately (it has already
 * written its own message and help to the streams).
 */

import {
	ConfigurationError,
	ContractAbortError,
	formatUserMessage,
	NotFoundError,
	SealError,
	TransportError,
	UnauthorizedError,
	UncertifiedBlobError,
	ValidationError,
} from "@arcadiasystems/morse-sdk";
import { CommanderError } from "commander";

import { toJson } from "../format/json.ts";
import { ExitCode } from "./exit-codes.ts";

/** Error raised by the CLI itself, carrying the exit code to report. */
export class CliError extends Error {
	readonly exitCode: ExitCode;

	constructor(
		message: string,
		exitCode: ExitCode = ExitCode.Generic,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
}

/** Bad invocation: missing input, invalid flag value, refused non-interactive prompt. */
export class UsageError extends CliError {
	constructor(message: string) {
		super(message, ExitCode.Usage);
		this.name = "UsageError";
	}
}

/**
 * Abort a destructive command after the user declines confirmation. Exits with
 * the usage code (2), matching the non-interactive refusal path so scripts see
 * one consistent "did not proceed" code.
 */
export function cancelled(): never {
	throw new UsageError("Cancelled. Nothing was changed.");
}

/** Keystore unlock or access failure (wrong password, insecure permissions). */
export class KeystoreError extends CliError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, ExitCode.Auth, options);
		this.name = "KeystoreError";
	}
}

// Move aborts that mean "you are not allowed", as opposed to bad input.
const AUTH_ABORT_REASONS: ReadonlySet<string> = new Set([
	"EUnauthorized",
	"EPublisherCapRevoked",
	"EPublisherCapWrongHolder",
]);

// Commander throws these after printing help or the version; they are not failures.
const COMMANDER_SUCCESS_CODES: ReadonlySet<string> = new Set([
	"commander.helpDisplayed",
	"commander.help",
	"commander.version",
]);

export function resolveExitCode(err: unknown): ExitCode {
	if (err instanceof CliError) {
		return err.exitCode;
	}
	if (err instanceof NotFoundError) {
		return ExitCode.NotFound;
	}
	if (err instanceof UnauthorizedError) {
		return ExitCode.Auth;
	}
	if (err instanceof ContractAbortError) {
		return AUTH_ABORT_REASONS.has(err.reason)
			? ExitCode.Auth
			: ExitCode.Generic;
	}
	if (err instanceof TransportError) {
		return ExitCode.Network;
	}
	// A Seal "no-access" is a permission failure; other Seal codes are runtime.
	if (err instanceof SealError) {
		return err.code === "no-access" ? ExitCode.Auth : ExitCode.Generic;
	}
	if (err instanceof ConfigurationError) {
		return ExitCode.Usage;
	}
	// Client-side input validation (malformed ids/addresses/slugs) is a usage
	// error, consistent with bad flags. Reader response-shape validation is rare.
	if (err instanceof ValidationError) {
		return ExitCode.Usage;
	}
	// Partial success: blob uploaded but the on-chain attach failed. Generic, but
	// mapped explicitly so the recoverable-failure contract is visible and tested.
	if (err instanceof UncertifiedBlobError) {
		return ExitCode.Generic;
	}
	return ExitCode.Generic;
}

function describe(err: unknown): { title: string; description: string } {
	if (err instanceof CliError) {
		return { title: "Error", description: err.message };
	}
	const formatted = formatUserMessage(err);
	return { title: formatted.title, description: formatted.description };
}

export function renderError(
	err: unknown,
	opts: { json: boolean; debug: boolean },
): void {
	const { title, description } = describe(err);
	const exitCode = resolveExitCode(err);
	if (opts.json) {
		process.stderr.write(
			`${toJson({ error: { title, description, exitCode } })}\n`,
		);
	} else {
		process.stderr.write(`Error: ${description}\n`);
	}
	if (opts.debug) {
		writeTrace(err);
	}
}

function writeTrace(err: unknown): void {
	let current: unknown = err;
	let prefix = "";
	while (current instanceof Error && current.stack) {
		process.stderr.write(`${prefix}${current.stack}\n`);
		prefix = "Caused by: ";
		current = (current as { cause?: unknown }).cause;
	}
}

/**
 * Resolve the exit code for any throw and render the message. Commander
 * help/version exits map to success; other commander parse failures to a usage
 * error without re-rendering (commander already wrote its own message).
 */
export function handleError(
	err: unknown,
	opts: { json: boolean; debug: boolean },
): ExitCode {
	if (err instanceof CommanderError) {
		return COMMANDER_SUCCESS_CODES.has(err.code)
			? ExitCode.Success
			: ExitCode.Usage;
	}
	renderError(err, opts);
	return resolveExitCode(err);
}
