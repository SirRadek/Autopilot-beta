import { describe, expect, it } from "vitest";

import { createControlPlaneClient } from "./controlPlaneClient";

describe("ControlPlaneClient configuration", () => {
  it("defaults to same-origin without requiring a browser secret", async () => {
    let requestedUrl = "";
    const fetcher = async (url: string) => { requestedUrl = url; return new Response(JSON.stringify({ sessions: { total: 0, active: 0, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } }); };
    await createControlPlaneClient({ fetcher }).getStatus();
    expect(requestedUrl).toBe("/status");
  });
});
