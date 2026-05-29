/** JSON serialization for CLI output. */

// SDK results carry types `JSON.stringify` mishandles: `bigint` (e.g.
// `gasUsedMist`) throws, and `Uint8Array` (e.g. `sealId`, quilt patch ids)
// serializes as an index-keyed object. Encode both as strings so the output is
// a single valid document with a stable, readable shape.
function replacer(_key: string, value: unknown): unknown {
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (value instanceof Uint8Array) {
		return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
	}
	return value;
}

/** Serialize a value to pretty JSON, encoding `bigint` as decimal and `Uint8Array` as `0x`-hex. */
export function toJson(value: unknown): string {
	return JSON.stringify(value, replacer, 2);
}
