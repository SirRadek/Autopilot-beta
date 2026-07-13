export function redactTelemetryText(value: string, maxChars = 2_000): string {
  const boundedMax = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 2_000;
  return value
    .replace(/-----BEGIN\b[\s\S]*/gi, "[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/("(?:authorization|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|cookie|set-cookie|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token))"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/('(?:authorization|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|cookie|set-cookie|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token))'\s*:\s*)'(?:\\.|[^'\\])*'/gi, "$1'[REDACTED]'")
    .replace(/\b(cookie|set-cookie)(\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token))(\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, "[REDACTED]")
    .replace(/\b(?:sk|or|ghp|gho|ghu|ghs|ghr|xoxb|xoxa|xoxp|xoxr|xoxs)[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .slice(0, boundedMax);
}

export function redactLegacyObservabilityText(value: string): string {
  return value
    .replace(/\b(?:sk|or|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]");
}
