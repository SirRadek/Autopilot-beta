export function redactTelemetryText(value: string, maxChars = 2_000): string {
  const boundedMax = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 2_000;
  return value
    .replace(/\b(?:sk|or|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .slice(0, boundedMax);
}
