/**
 * Output discipline: machine results to stdout, human messaging to stderr.
 * Color is gated on the stderr TTY (where all colored output goes) plus the
 * NO_COLOR / FORCE_COLOR contract.
 */

import { toJson } from "../format/json.ts";

const RESET = "\x1b[0m";
const YELLOW = "33";
const DIM = "2";

export interface OutputOptions {
	readonly json: boolean;
	readonly quiet: boolean;
	readonly color: boolean;
}

export class Output {
	constructor(private readonly options: OutputOptions) {}

	get isJson(): boolean {
		return this.options.json;
	}

	/**
	 * Primary command result. In JSON mode emits the structured value on stdout
	 * and nothing else; otherwise the human-readable string.
	 */
	result(human: string, data: unknown): void {
		if (this.options.json) {
			process.stdout.write(`${toJson(data)}\n`);
			return;
		}
		process.stdout.write(`${human}\n`);
	}

	/** Progress or informational messaging. Goes to stderr; silenced by --quiet and in JSON mode. */
	info(message: string): void {
		if (this.options.quiet || this.options.json) {
			return;
		}
		process.stderr.write(`${this.paint(message, DIM)}\n`);
	}

	/** Warning. Goes to stderr; silenced by --quiet and in JSON mode (stderr stays JSON-only there). */
	warn(message: string): void {
		if (this.options.quiet || this.options.json) {
			return;
		}
		process.stderr.write(`${this.paint(message, YELLOW)}\n`);
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
