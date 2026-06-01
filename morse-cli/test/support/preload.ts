/**
 * Force a non-interactive context for the whole hermetic suite. In a real
 * terminal process.stdin is a TTY, which makes isInteractive() true and a
 * confirmation prompt block on keyboard input; in CI it is not. Pinning isTTY to
 * false here makes confirm/prompt guards behave identically in a dev terminal
 * and in CI, so the in-process tests never hang waiting for stdin. Subprocess
 * tests are unaffected (their child stdin is its own, already non-TTY).
 */

for (const stream of [process.stdin, process.stdout, process.stderr]) {
	Object.defineProperty(stream, "isTTY", { value: false, configurable: true });
}
