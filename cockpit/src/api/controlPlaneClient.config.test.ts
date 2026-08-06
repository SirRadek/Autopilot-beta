import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createControlPlaneClient } from "./controlPlaneClient";

describe("ControlPlaneClient configuration", () => {
  it("proxies every governed same-origin API family", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    for (const path of ["/projects", "/runs", "/incidents", "/observability", "/promotions", "/brainstorms", "/figma"]) expect(config).toContain(`"${path}"`);
  });

  it("defaults to same-origin without requiring a browser secret", async () => {
    let requestedUrl = "";
    const fetcher = async (url: string) => { requestedUrl = url; return new Response(JSON.stringify({ sessions: { total: 0, active: 0, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } }); };
    await createControlPlaneClient({ fetcher }).getStatus();
    expect(requestedUrl).toBe("/status");
  });
});
