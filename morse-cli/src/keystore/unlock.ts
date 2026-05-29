/** Resolve a keystore password from the environment or an interactive prompt. */

import { KeystoreError, UsageError } from "../cli/errors.ts";
import { isInteractive, promptHidden } from "../cli/prompts.ts";

const MIN_PASSWORD_LENGTH = 8;

type Env = Record<string, string | undefined>;

/**
 * Resolve a password. `MORSE_KEYSTORE_PASSWORD` wins for CI; otherwise prompt on
 * a TTY. `create` prompts twice and enforces a minimum length; `unlock` prompts
 * once. Fails clearly when no password source is available.
 */
export async function resolvePassword(
	purpose: "create" | "unlock",
	env: Env = process.env,
	signal?: AbortSignal,
): Promise<string> {
	const fromEnv = env.MORSE_KEYSTORE_PASSWORD;
	if (fromEnv !== undefined && fromEnv.length > 0) {
		return fromEnv;
	}
	if (!isInteractive()) {
		throw new KeystoreError(
			"No keystore password available. Set MORSE_KEYSTORE_PASSWORD or run in an interactive terminal.",
		);
	}
	if (purpose === "unlock") {
		return promptHidden("Keystore password (hidden): ", signal);
	}
	const first = await promptHidden(
		`New keystore password (hidden, min ${MIN_PASSWORD_LENGTH} chars): `,
		signal,
	);
	if (first.length < MIN_PASSWORD_LENGTH) {
		throw new UsageError(
			`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
		);
	}
	const second = await promptHidden("Confirm password (hidden): ", signal);
	if (first !== second) {
		throw new UsageError("Passwords do not match.");
	}
	return first;
}
