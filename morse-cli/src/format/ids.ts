/** Display helpers for long Sui IDs and addresses. */

const HEAD = 6;
const TAIL = 4;

/** Abbreviate a long hex ID as `0x1234...abcd`; short values pass through. */
export function shortId(id: string): string {
	// Skip abbreviation when the ellipsis (3 chars) would not actually shorten it.
	if (id.length <= HEAD + TAIL + 3) {
		return id;
	}
	return `${id.slice(0, HEAD)}...${id.slice(-TAIL)}`;
}
