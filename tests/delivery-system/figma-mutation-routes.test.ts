import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleFigmaMutationRoute } from "../../src/data/delivery-system/figmaMutationRoutes";

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return { method, url, async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } } as unknown as IncomingMessage;
}
function mockRes(): { res: ServerResponse; get: () => { status: number; body: string } } {
  const state = { status: 0, body: "" };
  const res = { writeHead(status: number) { state.status = status; return res; }, end(payload?: string) { state.body = payload ?? ""; } };
  return { res: res as unknown as ServerResponse, get: () => state };
}
async function call(dir: string, method: string, url: string, body?: unknown): Promise<{ handled: boolean; status: number; json: any }> {
  const { res, get } = mockRes();
  const handled = await handleFigmaMutationRoute(mockReq(method, url, body), res, dir);
  const state = get();
  return { handled, status: state.status, json: state.body ? JSON.parse(state.body) : undefined };
}

const proposal = {
  schemaVersion: "autopilot.figma-mutation/1",
  source: { provider: "figma", fileKey: "FK" },
  briefHash: "a".repeat(64),
  expectedVersion: "v1",
  ops: [{ op: "createFrame", args: { name: "X" } }],
  rollbackPlan: { versionCheckpoint: true },
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "figma-routes-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("figma mutation routes", () => {
  it("ignores non-figma paths", async () => {
    const { res } = mockRes();
    expect(await handleFigmaMutationRoute(mockReq("GET", "/status"), res, dir)).toBe(false);
  });

  it("runs the full lifecycle: submit -> list -> approve(lease) -> claim(single-use) -> result", async () => {
    const submit = await call(dir, "POST", "/figma/mutations", proposal);
    expect(submit.status).toBe(201);
    expect(submit.json.status).toBe("pending");
    expect(submit.json.lease).toBeUndefined();
    const id = submit.json.id as string;

    const list = await call(dir, "GET", "/figma/mutations");
    expect(list.json).toHaveLength(1);

    const approve = await call(dir, "POST", `/figma/mutations/${id}`, { decision: "approved", approver: "owner" });
    expect(approve.status).toBe(200);
    expect(approve.json.lease).toMatch(/^[a-f0-9]{64}$/);

    const claim = await call(dir, "POST", "/figma/mutations/claim", { fileKey: "FK", lease: approve.json.lease });
    expect(claim.status).toBe(200);
    expect(claim.json.ops[0].op).toBe("createFrame");

    const claimAgain = await call(dir, "POST", "/figma/mutations/claim", { fileKey: "FK", lease: approve.json.lease });
    expect(claimAgain.status).toBe(403);

    const result = await call(dir, "POST", `/figma/mutations/${id}/result`, { node_ids: ["1:1"], digest: "d" });
    expect(result.json.status).toBe("executed");

    const verify = await call(dir, "POST", `/figma/mutations/${id}/verify`, { ok: true });
    expect(verify.status).toBe(200);
    expect(verify.json.status).toBe("verified");
  });

  it("rejects a submit with an op outside the allowlist (400)", async () => {
    const bad = await call(dir, "POST", "/figma/mutations", { ...proposal, ops: [{ op: "executeJS" }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_mutation_proposal");
  });

  it("rejects a wrong lease (403) and a bad decision (400)", async () => {
    const submit = await call(dir, "POST", "/figma/mutations", proposal);
    const wrongLease = await call(dir, "POST", "/figma/mutations/claim", { fileKey: "FK", lease: "b".repeat(64) });
    expect(wrongLease.status).toBe(403);
    const badDecision = await call(dir, "POST", `/figma/mutations/${submit.json.id}`, { decision: "maybe" });
    expect(badDecision.status).toBe(400);
  });
});
