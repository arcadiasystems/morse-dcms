/**
 * Output discipline: machine results to stdout, human messaging to stderr.
 * Color is gated on the stderr TTY (where all colored output goes) plus the
 * NO_COLOR / FORCE_COLOR contract.
 */

import type { Network } from "@arcadiasystems/morse-sdk";

import { toJson } from "../format/json.ts";

const RESET = "\x1b[0m";
const YELLOW = "33";
const DIM = "2";

export interface OutputOptions {
	readonly json: boolean;
	readonly quiet: boolean;
	readonly color: boolean;
	// Stream sinks default to the process streams; injected in tests to capture
	// output without monkeypatching globals.
	readonly writeOut?: (text: string) => void;
	readonly writeErr?: (text: string) => void;
	/**
	 * Network to stamp onto results. Set only on the gas-spending write
	 * contexts, so read and list output is unchanged. See `Output.result`.
	 */
	readonly network?: Network;
}

export class Output {
	constructor(private readonly options: OutputOptions) {}

	get isJson(): boolean {
		return this.options.json;
	}

	/**
	 * Derive an Output that stamps `network` onto every result. Applied to the
	 * write contexts in `cli/context.ts` so a command that spends real SUI and
	 * WAL always says which chain it spent it on, in both human and JSON modes.
	 */
	withNetwork(network: Network): Output {
		return new Output({ ...this.options, network });
	}

	/**
	 * Primary command result. In JSON mode emits the structured value on stdout
	 * and nothing else; otherwise the human-readable string.
	 */
	result(human: string, data: unknown): void {
		if (this.options.json) {
			this.out(`${toJson(this.stampJson(data))}\n`);
			return;
		}
		this.out(`${this.stampHuman(human)}\n`);
	}

	/**
	 * Add the network to a JSON result. Non-destructive: an existing `network`
	 * key wins, and non-object payloads (arrays, primitives) pass through
	 * untouched rather than being wrapped into a different shape.
	 */
	private stampJson(data: unknown): unknown {
		const network = this.options.network;
		if (network === undefined || !isPlainObject(data) || "network" in data) {
			return data;
		}
		return { network, ...data };
	}

	/**
	 * Insert the network as the first detail line, directly under the result's
	 * headline. Write results are pre-formatted blocks of `  label: value`
	 * lines under a summary line, so appending would strand it after trailing
	 * prose like "Selected as the active publication.". The padding is a fixed
	 * width chosen to line up with the widest label in today's write results
	 * (`publisherCap:`); narrower blocks sit a space or two off, which is
	 * cosmetic only.
	 */
	private stampHuman(human: string): string {
		const network = this.options.network;
		if (network === undefined) {
			return human;
		}
		const line = `  network:      ${network}`;
		const breakAt = human.indexOf("\n");
		if (breakAt === -1) {
			return `${human}\n${line}`;
		}
		return `${human.slice(0, breakAt)}\n${line}${human.slice(breakAt)}`;
	}

	/** Progress or informational messaging. Goes to stderr; silenced by --quiet and in JSON mode. */
	info(message: string): void {
		if (this.options.quiet || this.options.json) {
			return;
		}
		this.err(`${this.paint(message, DIM)}\n`);
	}

	/** Warning. Goes to stderr; silenced by --quiet and in JSON mode (stderr stays JSON-only there). */
	warn(message: string): void {
		if (this.options.quiet || this.options.json) {
			return;
		}
		this.err(`${this.paint(message, YELLOW)}\n`);
	}

	private out(text: string): void {
		if (this.options.writeOut !== undefined) {
			this.options.writeOut(text);
			return;
		}
		process.stdout.write(text);
	}

	private err(text: string): void {
		if (this.options.writeErr !== undefined) {
			this.options.writeErr(text);
			return;
		}
		process.stderr.write(text);
	}

	private paint(text: string, code: string): string {
		return this.options.color ? `\x1b[${code}m${text}${RESET}` : text;
	}
}

/**
 * Resolve color support: never in JSON mode; disabled by a non-empty NO_COLOR;
 * forced by a non-empty FORCE_COLOR; otherwise only when stderr is a TTY.
 * Gated on stderr because every colored message (`info`, `warn`) is written
 * there, not stdout.
 */
export function resolveColor(json: boolean): boolean {
	if (json) {
		return false;
	}
	if (process.env.NO_COLOR) {
		return false;
	}
	if (process.env.FORCE_COLOR) {
		return true;
	}
	return Boolean(process.stderr.isTTY);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createOutput(opts: {
	json?: boolean;
	quiet?: boolean;
}): Output {
	const json = Boolean(opts.json);
	return new Output({
		json,
		quiet: Boolean(opts.quiet),
		color: resolveColor(json),
	});
}
