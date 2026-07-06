// Locale-INDEPENDENT string comparator for every sort whose order feeds committed or otherwise
// deterministic artifacts. `String.prototype.localeCompare` is a function of the HOST locale, not
// the data: cs-CZ collation sorts the "ch" digraph after "h", which made committed score fixtures
// differ between a Czech dev machine and the en-US CI runner (PR #9 CI break, 2026-07-06). Plain
// UTF-16 codepoint order is identical on every machine.
export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
