import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

function gateway(limit = 100) { return new TokenGateway({ stateDir: mkdtempSync(join(tmpdir(), "gateway-group-")), limits: { inputCapTokens: 100, outputCapTokens: 100, providerBudgetTokens: limit, modelBudgetTokens: limit, sessionBudgetTokens: limit } }); }
const request = { groupId: "bsg-example", slots: [
  { slotId: "fanout-0", provider: "codex_cli", model: "gpt-5", sessionId: "bgr-example-fanout-0", holdTokens: 12 },
  { slotId: "fanout-1", provider: "claude_cli", model: "sonnet", sessionId: "bgr-example-fanout-1", holdTokens: 12 },
] } as const;

describe("token gateway orchestration groups", () => {
  it("atomically reserves exact route holds with exact-input idempotency", () => {
    const subject = gateway();
    const reserved = subject.reserveGroup(request);
    expect(reserved.maximumTokens).toBe(24);
    expect(subject.reserveGroup(request)).toEqual(reserved);
    expect(() => subject.reserveGroup({ ...request, slots: [{ ...request.slots[0], holdTokens: 13 }, request.slots[1]] })).toThrow("token_group_mismatch");
    expect(subject.snapshot().used).toMatchObject({ "provider:codex_cli": 12, "provider:claude_cli": 12 });
  });

  it("rejects every hold atomically when one aggregate route exceeds budget", () => {
    const subject = gateway(20);
    expect(() => subject.reserveGroup({ groupId: "g", slots: [
      { slotId: "a", provider: "codex_cli", model: "gpt-5", sessionId: "s-a", holdTokens: 11 },
      { slotId: "b", provider: "codex_cli", model: "gpt-5", sessionId: "s-b", holdTokens: 10 },
    ] })).toThrow("token_budget_exhausted");
    expect(subject.snapshot()).toEqual({ used: {}, activeReservations: 0 });
  });

  it("claims without growing usage, settles by replacing the full hold, and releases unused slots idempotently", () => {
    const subject = gateway(); subject.reserveGroup(request);
    const before = subject.snapshot().used;
    const claimed = subject.claimGroupSlot("bsg-example", "fanout-0", { provider: "codex_cli", model: "gpt-5", sessionId: "bgr-example-fanout-0", inputTokens: 3, outputTokens: 5, handoffId: "h-0" });
    expect(subject.snapshot().used).toEqual(before);
    expect(claimed).toMatchObject({ groupId: "bsg-example", slotId: "fanout-0", heldTokens: 12, totalTokens: 8 });
    expect(() => subject.claimGroupSlot("bsg-example", "fanout-0", { ...claimed, inputTokens: 2 })).toThrow("token_group_slot_mismatch");
    subject.settle(claimed, { inputTokens: 2, outputTokens: 3 });
    expect(subject.snapshot().used["provider:codex_cli"]).toBe(5);
    subject.releaseGroupSlots("bsg-example", ["fanout-1"]);
    subject.releaseGroupSlots("bsg-example", ["fanout-1"]);
    expect(subject.snapshot().used["provider:claude_cli"]).toBeUndefined();
    expect(subject.findGroup("bsg-example")?.slots.map((slot) => slot.state)).toEqual(["settled", "released"]);
  });
});
