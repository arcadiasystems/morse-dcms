/** Interactive prompts. All prompt IO goes to stderr so stdout stays clean. */

import * as readline from "node:readline";

import { UsageError } from "./errors.ts";

/** True when both stdin and stderr are TTYs, so a prompt can be shown and answered. */
export function isInteractive(): boolean {
	return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** An AbortSignal that fires on the first Ctrl+C, so prompts can abort cleanly. */
export function sigintSignal(): AbortSignal {
	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());
	return controller.signal;
}

/**
 * Read a line without echoing it, for passwords and secret keys. Requires a TTY;
 * callers must check `isInteractive()` first and offer an env-var path otherwise.
 * Pass a `signal` so Ctrl+C aborts the wait instead of leaving the terminal open.
 */
export function promptHidden(
	label: string,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stderr,
			terminal: true,
		});
		const onAbort = (): void => {
			rl.close();
			reject(new UsageError("Prompt aborted."));
		};
		bindAbort(signal, onAbort);
		// readline writes both the prompt label and the typed echo via
		// _writeToOutput (a private API; Bun matches Node's behavior). Let the
		// label through (written synchronously by `question`), then mute so the
		// secret never appears on screen.
		let muted = false;
		const mutable = rl as unknown as { _writeToOutput: (text: string) => void };
		mutable._writeToOutput = (text: string): void => {
			if (!muted) {
				process.stderr.write(text);
			}
		};
		rl.question(label, (answer) => {
			signal?.removeEventListener("abort", onAbort);
			rl.close();
			process.stderr.write("\n");
			resolve(answer);
		});
		muted = true;
		rl.on("error", reject);
	});
}

/**
 * Yes/no confirmation. Returns true immediately when `assumeYes` is set; throws
 * a `UsageError` in a non-interactive context so destructive ops never proceed
 * silently in scripts.
 */
export async function confirm(
	message: string,
	options: { assumeYes?: boolean; signal?: AbortSignal } = {},
): Promise<boolean> {
	if (options.assumeYes) {
		return true;
	}
	if (!isInteractive()) {
		throw new UsageError(
			`${message} Refusing to prompt in a non-interactive context; pass --yes to proceed.`,
		);
	}
	const answer = await question(`${message} [y/N] `, options.signal);
	return /^y(es)?$/i.test(answer.trim());
}

function question(prompt: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stderr,
		});
		const onAbort = (): void => {
			rl.close();
			reject(new UsageError("Prompt aborted."));
		};
		bindAbort(signal, onAbort);
		rl.question(prompt, (answer) => {
			signal?.removeEventListener("abort", onAbort);
			rl.close();
			resolve(answer);
		});
		rl.on("error", reject);
	});
}

function bindAbort(signal: AbortSignal | undefined, onAbort: () => void): void {
	if (signal === undefined) {
		return;
	}
	if (signal.aborted) {
		onAbort();
		return;
	}
	signal.addEventListener("abort", onAbort, { once: true });
}
