/**
 * Process lifecycle around a command: a guard for an idle HTTP/2 socket closing
 * under Node's fetch, and a prompt exit once the command has finished.
 *
 * Node 26's fetch speaks HTTP/2. When a request on an established session is
 * aborted, its stream can outlive the request, and when the session's idle
 * timer later closes the socket the stream emits "socket idle timeout" with no
 * listener (nodejs/undici#6143). Walrus reads abort their remaining sliver
 * requests once enough have arrived, so a read that had already succeeded
 * crashed the process a few seconds later and exited 1.
 */

import { ExitCode } from "./exit-codes.ts";

/** True for the error undici emits when it closes an idle HTTP/2 socket. */
export function isIdleSocketTimeout(err: unknown): boolean {
	return (
		err instanceof Error &&
		err.name === "InformationalError" &&
		(err as { code?: unknown }).code === "UND_ERR_INFO" &&
		err.message === "socket idle timeout"
	);
}

interface FlushableStream {
	write(text: string, done?: () => void): unknown;
}

/** The slice of `process` this module uses, so tests can drive it without one. */
export interface CommandProcess {
	on(event: "uncaughtException", listener: (err: unknown) => void): unknown;
	exit(code: number): void;
	exitCode?: number | string | null | undefined;
	readonly stdout: FlushableStream;
	readonly stderr: FlushableStream;
}

/**
 * Ignore idle-socket closes, which belong to no pending work. Every other
 * uncaught exception still ends the process as Node would: trace on stderr,
 * exit 1.
 */
export function ignoreIdleSocketTimeouts(proc: CommandProcess = process): void {
	proc.on("uncaughtException", (err) => {
		if (isIdleSocketTimeout(err)) {
			return;
		}
		const trace = err instanceof Error && err.stack ? err.stack : String(err);
		proc.stderr.write(`${trace}\n`);
		proc.exit(ExitCode.Generic);
	});
}

function flushed(stream: FlushableStream): Promise<void> {
	return new Promise((resolve) => {
		stream.write("", () => resolve());
	});
}

/**
 * End the process once a command has finished, with the exit code already set.
 * The Sui and Walrus clients leave keep-alive sockets open, which held a
 * finished command for seconds on Node 22 and minutes on Node 26. Both streams
 * are flushed first, so output redirected to a pipe is not cut short.
 */
export async function exitWhenFlushed(
	proc: CommandProcess = process,
): Promise<void> {
	await Promise.all([flushed(proc.stdout), flushed(proc.stderr)]);
	proc.exit(Number(proc.exitCode ?? ExitCode.Success));
}
