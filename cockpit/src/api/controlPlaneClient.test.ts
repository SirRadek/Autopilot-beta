import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiError, createControlPlaneClient } from "./controlPlaneClient";

describe("ControlPlaneClient", () => {
  it("sends bearer auth and returns typed status", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: { total: 1, active: 1, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", token: "secret", fetcher });
    const status = await client.getStatus();
    expect(status.sessions.active).toBe(1);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.credentials).toBe("include");
  });

  it("supports browser session login without requiring a Vite token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: true, expires_at: "2030-01-01T00:00:00.000Z" }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    await client.login("entered-at-login");
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/auth/login");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ token: "entered-at-login" }));
  });

  it("throws typed errors for 401 and 404", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", token: "secret", fetcher });
    await expect(client.getStatus()).rejects.toMatchObject({ status: 401 });
    await expect(client.getProviderQuotas()).rejects.toMatchObject({ status: 404 });
  });

  it("bounds error response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("x".repeat(5000), { status: 500 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", token: "secret", fetcher });
    await expect(client.getStatus()).rejects.toSatisfy((error: unknown) => error instanceof ControlPlaneApiError && error.message.length <= 600);
  });

  it("requests an encoded bounded observability timeline", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: { events: 0 }, timeline: [], limits: {} }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    await client.getObservabilityTimeline({ session_id: "project/a", limit: 25 });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/observability/timeline?session_id=project%2Fa&limit=25");
  });
});
