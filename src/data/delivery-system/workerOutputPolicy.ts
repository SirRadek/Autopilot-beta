import { redactTelemetryText } from "./telemetryRedaction";

export const MAX_PERSISTED_WORKER_OUTPUT_CHARS = 32_000;
const MAX_PERSISTED_WORKER_ERROR_CHARS = 2_000;
const REDACTION_FAILURE = "[REDACTION_FAILED]";

export function sanitizeWorkerOutput(
  value: string,
  maxChars = MAX_PERSISTED_WORKER_OUTPUT_CHARS
): string {
  return sanitize(value, maxChars);
}

export function sanitizeWorkerError(value: string | null, maxChars = MAX_PERSISTED_WORKER_ERROR_CHARS): string | null {
  return value === null ? null : sanitize(value, maxChars);
}

export function parseSanitizedWorkerJson(value: string): unknown | null {
  try {
    return JSON.parse(sanitizeWorkerOutput(value)) as unknown;
  } catch {
    return null;
  }
}

function sanitize(value: string, maxChars: number): string {
  const bound = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  let sanitized: string;
  try {
    sanitized = redactTelemetryText(value, bound);
  } catch {
    sanitized = REDACTION_FAILURE.slice(0, bound);
  }
  if (sanitized.length > 0 && isHighSurrogate(sanitized.charCodeAt(sanitized.length - 1))) {
    return sanitized.slice(0, -1);
  }
  return sanitized;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}
