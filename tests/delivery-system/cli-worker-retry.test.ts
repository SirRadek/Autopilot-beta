import { describe, expect, it } from "vitest";

import {
  resolveCodexMaxAttempts,
  shouldRetryCodex
} from "../../src/data/delivery-system/cliWorkerCapture";

describe("shouldRetryCodex", () => {
  it("does not multiply capture retries under supervisor ownership", () => {
    expect(resolveCodexMaxAttempts({ retries: 1, supervisorOwnsRetry: true })).toBe(1);
    expect(resolveCodexMaxAttempts({ retries: 1, supervisorOwnsRetry: false })).toBe(2);
  });

  it.each([
    {
      name: "retries empty output when the attempt did not time out and attempts remain",
      input: { emptyOutput: true, timedOut: false, attempt: 1, maxAttempts: 2 },
      expected: true
    },
    {
      name: "does not retry timed out empty output",
      input: { emptyOutput: true, timedOut: true, attempt: 1, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry when attempts are exhausted",
      input: { emptyOutput: true, timedOut: false, attempt: 2, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry non-empty output",
      input: { emptyOutput: false, timedOut: false, attempt: 1, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry on the boundary attempt equal to maxAttempts",
      input: { emptyOutput: true, timedOut: false, attempt: 3, maxAttempts: 3 },
      expected: false
    },
    {
      name: "does not retry non-empty timed out output",
      input: { emptyOutput: false, timedOut: true, attempt: 1, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry non-empty exhausted output",
      input: { emptyOutput: false, timedOut: false, attempt: 2, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry timed out exhausted output",
      input: { emptyOutput: true, timedOut: true, attempt: 2, maxAttempts: 2 },
      expected: false
    },
    {
      name: "does not retry non-empty timed out exhausted output",
      input: { emptyOutput: false, timedOut: true, attempt: 2, maxAttempts: 2 },
      expected: false
    }
  ])("$name", ({ input, expected }) => {
    expect(shouldRetryCodex(input)).toBe(expected);
  });
});
