/**
 * Seal key servers supplied by the operator, from the environment.
 *
 * Not flags: an API key in argv leaks through `ps` and shell history, the same
 * reasoning that keeps the signing key out of argv. Not a config-file field
 * either, since the value is a credential and the config file is plain text.
 *
 * Two forms, because operators come in two shapes:
 *   - `MORSE_SEAL_API_KEY` is the common case: a credential for Mysten's
 *     decentralized committee, which the SDK already exports the object id and
 *     aggregator URL for. Optionally paired with `MORSE_SEAL_API_KEY_NAME`
 *     when an operator wants a header other than `X-API-Key`.
 *   - `MORSE_SEAL_KEY_SERVERS` is the general case: a JSON array of
 *     `KeyServerConfig` for an independent operator, or several.
 */

import { MAINNET_SEAL_COMMITTEE } from "@arcadiasystems/morse-sdk";
// The SDK does not re-export this; its own examples take it from @mysten/seal.
import type { KeyServerConfig } from "@mysten/seal";

import { UsageError } from "../cli/errors.ts";

type Env = Record<string, string | undefined>;

/** Header name Mysten's committee expects unless an operator says otherwise. */
const DEFAULT_API_KEY_NAME = "X-API-Key";

/**
 * Key servers from the environment, or `undefined` to fall back to whatever
 * `morseConfig` pins for the network. `MORSE_SEAL_KEY_SERVERS` wins when both
 * are set, being the more specific of the two.
 */
export interface SealServersFromEnv {
	readonly servers: readonly KeyServerConfig[];
	/**
	 * Aggregator to pre-flight the credential against, when we know one. Only
	 * set for the committee shorthand; an arbitrary operator's servers may not
	 * route through an aggregator at all.
	 */
	readonly verifyUrl?: string;
	readonly apiKeyName?: string;
	readonly apiKey?: string;
}

export function sealServersFromEnv(
	env: Env = process.env,
): SealServersFromEnv | undefined {
	const explicit = env.MORSE_SEAL_KEY_SERVERS;
	if (explicit !== undefined && explicit.length > 0) {
		return { servers: parseKeyServers(explicit) };
	}
	const apiKey = env.MORSE_SEAL_API_KEY;
	if (apiKey === undefined || apiKey.length === 0) {
		return undefined;
	}
	const apiKeyName = env.MORSE_SEAL_API_KEY_NAME ?? DEFAULT_API_KEY_NAME;
	return {
		servers: MAINNET_SEAL_COMMITTEE.map((server) => ({
			...server,
			apiKeyName,
			apiKey,
		})),
		...(MAINNET_SEAL_COMMITTEE[0]?.aggregatorUrl === undefined
			? {}
			: { verifyUrl: MAINNET_SEAL_COMMITTEE[0].aggregatorUrl }),
		apiKeyName,
		apiKey,
	};
}

/**
 * Reject a credential the operator already refuses, before anything is
 * encrypted or paid for.
 *
 * Seal reads key-server public keys from chain but fetches key shares from the
 * operator, so a bad credential lets `encrypt` succeed and fails only at
 * `decrypt`: the user pays to store ciphertext they can never read. That exact
 * shape shipped once already as the mainnet default. Only an explicit 401/403
 * refuses; anything else (offline, rate-limited, an unexpected status) proceeds,
 * because a flaky check must never block a working key.
 */
export async function assertSealCredentialAccepted(
	env: SealServersFromEnv,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	if (env.verifyUrl === undefined || env.apiKey === undefined) {
		return;
	}
	let status: number;
	try {
		const response = await fetchImpl(`${env.verifyUrl}/v1/service`, {
			headers: { [env.apiKeyName ?? DEFAULT_API_KEY_NAME]: env.apiKey },
		});
		status = response.status;
	} catch {
		return;
	}
	if (status === 401 || status === 403) {
		throw new UsageError(
			`The Seal operator at ${env.verifyUrl} rejected your credential (HTTP ${status}). Encrypting anyway would produce content you could never decrypt, so this stops here. Check MORSE_SEAL_API_KEY.`,
		);
	}
}

/** Parse and validate the JSON array form, rejecting anything unusable. */
function parseKeyServers(raw: string): readonly KeyServerConfig[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new UsageError(
			`MORSE_SEAL_KEY_SERVERS is not valid JSON: ${String(cause)}`,
		);
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new UsageError(
			'MORSE_SEAL_KEY_SERVERS must be a non-empty JSON array of { objectId, weight } entries, e.g. [{"objectId":"0x...","weight":1}].',
		);
	}
	return parsed.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) {
			throw new UsageError(
				`MORSE_SEAL_KEY_SERVERS[${index}] is not an object.`,
			);
		}
		const { objectId, weight } = entry as Record<string, unknown>;
		if (typeof objectId !== "string" || !objectId.startsWith("0x")) {
			throw new UsageError(
				`MORSE_SEAL_KEY_SERVERS[${index}].objectId must be a 0x-prefixed object id.`,
			);
		}
		if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 1) {
			throw new UsageError(
				`MORSE_SEAL_KEY_SERVERS[${index}].weight must be a positive integer.`,
			);
		}
		// Everything else (aggregatorUrl, apiKeyName, apiKey) passes through as
		// given: Seal enforces its own committee-vs-independent rules, and
		// second-guessing them here would just duplicate that logic badly.
		return entry as KeyServerConfig;
	});
}
