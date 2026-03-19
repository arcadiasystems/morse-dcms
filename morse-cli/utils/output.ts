export function die(msg: string): never {
	process.stderr.write(`Error: ${msg}\n`);
	process.exit(1);
}
