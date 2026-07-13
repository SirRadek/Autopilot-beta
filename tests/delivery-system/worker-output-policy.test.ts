import { describe, expect, it } from "vitest";

import {
  MAX_PERSISTED_WORKER_OUTPUT_CHARS,
  parseSanitizedWorkerJson,
  sanitizeWorkerError,
  sanitizeWorkerOutput
} from "../../src/data/delivery-system/workerOutputPolicy";

const SECRET_FIXTURE = [
  "Authorization: Bearer secret-token-value",
  "password=hunter-two-secret",
  "api_key=sk-secret-api-key-value",
  "cookie: session=secret-cookie-value",
  "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----"
].join("\n");

describe("worker output policy", () => {
  it("redacts supported secret forms through the telemetry authority", () => {
    const sanitized = sanitizeWorkerOutput(SECRET_FIXTURE);

    expect(sanitized).not.toContain("secret-token-value");
    expect(sanitized).not.toContain("hunter-two-secret");
    expect(sanitized).not.toContain("secret-api-key-value");
    expect(sanitized).not.toContain("secret-cookie-value");
    expect(sanitized).not.toContain("private-material");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("bounds Unicode output without leaving a dangling surrogate", () => {
    const sanitized = sanitizeWorkerOutput("🔐".repeat(40_000));

    expect(sanitized.length).toBeLessThanOrEqual(MAX_PERSISTED_WORKER_OUTPUT_CHARS);
    expect(sanitized.endsWith("\ud83d")).toBe(false);
  });

  it("is idempotent", () => {
    expect(sanitizeWorkerOutput(sanitizeWorkerOutput(SECRET_FIXTURE)))
      .toBe(sanitizeWorkerOutput(SECRET_FIXTURE));
  });

  it("uses the smaller error bound and preserves null", () => {
    expect(sanitizeWorkerError(null)).toBeNull();
    expect(sanitizeWorkerError(`password=secret ${"x".repeat(4_000)}`)?.length).toBeLessThanOrEqual(2_000);
    expect(sanitizeWorkerError("password=secret")).not.toContain("secret");
  });

  it("parses only the sanitized representation", () => {
    expect(parseSanitizedWorkerJson('{"password":"secret-value","answer":42}')).toEqual({
      password: "[REDACTED]",
      answer: 42
    });
    expect(parseSanitizedWorkerJson("not json")).toBeNull();
  });

  it("fails closed when a runtime caller violates the string contract", () => {
    expect(sanitizeWorkerOutput(null as unknown as string)).toBe("[REDACTION_FAILED]");
  });
});
