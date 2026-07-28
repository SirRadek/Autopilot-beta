import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiError, createControlPlaneClient } from "./controlPlaneClient";

describe("ControlPlaneClient", () => {
  it("sends bearer auth and returns typed status", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: { total: 1, active: 1, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", serviceToken: "secret", fetcher });
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
    await client.login({ username: "admin.owner", password: "entered-at-login" });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/auth/login");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ username: "admin.owner", password: "entered-at-login" }));
  });

  it("throws typed errors for 401 and 404", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", serviceToken: "secret", fetcher });
    await expect(client.getStatus()).rejects.toMatchObject({ status: 401 });
    await expect(client.getProviderQuotas()).rejects.toMatchObject({ status: 404 });
  });

  it("bounds error response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("x".repeat(5000), { status: 500 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", serviceToken: "secret", fetcher });
    await expect(client.getStatus()).rejects.toSatisfy((error: unknown) => error instanceof ControlPlaneApiError && error.message.length <= 600);
  });

  it("requests an encoded bounded observability timeline", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: { events: 0 }, timeline: [], limits: {} }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    await client.getObservabilityTimeline({ session_id: "project/a", limit: 25 });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/observability/timeline?session_id=project%2Fa&limit=25");
  });

  it("creates a project with an exact same-origin JSON request", async () => {
    const project = { schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(project), { status: 201 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });

    await client.createProject({ name: "Alpha", cwd: "/work/alpha" });

    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/projects");
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Alpha", cwd: "/work/alpha" });
  });

  it("uses the governed project, run, and incident routes with exact JSON bodies", async () => {
    const run = { current: { run_id: "run/1", revision: 3 } };
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(run), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    const draft = { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli" as const, model: null, estimated_tokens: 3, requested_artifacts: ["text" as const] };

    await client.getProjects();
    await client.getRuns("draft");
    await client.getRun("run/1");
    await client.prepareRun(draft);
    await client.reviseRun("run/1", 3, draft);
    await client.approveRun("run/1", 3, "owner");
    await client.cancelRun("run/1");
    await client.getIncidents();
    await client.acknowledgeIncident("incident/1", "owner");
    await client.prepareRepairPacket("incident/1", { expected: "up", actual: "down" });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://cp/projects", "http://cp/runs?status=draft", "http://cp/runs/run%2F1", "http://cp/runs",
      "http://cp/runs/run%2F1/revisions", "http://cp/runs/run%2F1/approve", "http://cp/runs/run%2F1/cancel",
      "http://cp/incidents", "http://cp/incidents/incident%2F1/acknowledge", "http://cp/incidents/incident%2F1/repair-packet"
    ]);
    expect(JSON.parse(fetcher.mock.calls[3]?.[1]?.body as string)).toEqual({ ...draft, profile: "dev", promotion_packet_id: null });
    expect(JSON.parse(fetcher.mock.calls[4]?.[1]?.body as string)).toEqual({ ...draft, revision: 3 });
    expect(JSON.parse(fetcher.mock.calls[5]?.[1]?.body as string)).toEqual({ revision: 3, operator: "owner" });
    expect(fetcher.mock.calls.every(([, init]) => init.credentials === "include")).toBe(true);
  });

  it("keeps the legacy prepareRun alias DEV-only and exposes the explicit PROD draft path", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ current: {} }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    const body = { project_id: "autopilot-beta", prompt: "Inspect", provider: "codex_cli" as const, model: "gpt-5", estimated_tokens: 9_000, requested_artifacts: ["text" as const] };
    await client.prepareRun({ ...body, profile: "prod", promotion_packet_id: "forged" } as never);
    await client.createProdDraft("packet-1", "verify-1", body);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ ...body, profile: "dev", promotion_packet_id: null });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({ ...body, profile: "prod", promotion_packet_id: "packet-1", full_verification_ref: "verify-1" });
  });

  it("uses the explicit reject endpoint without publishing", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: "rejected" }), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    await client.rejectPromotion("packet/1");
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://cp/promotions/packet%2F1/reject");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("uses the brainstorm routes with exact JSON bodies and no coercion", async () => {
    const record = { brainstorm_id: "bs/1", status: "draft" };
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(record), { status: 200 }));
    const client = createControlPlaneClient({ baseUrl: "http://cp", fetcher });
    const draft = {
      project_id: "autopilot-beta",
      brief: "Explore approaches",
      routes: [
        { provider: "codex_cli" as const, model: "model-a", requested_reasoning_effort: "low" as const },
        { provider: "claude_cli" as const, model: "model-a", requested_reasoning_effort: "low" as const },
        { provider: "agy_cli" as const, model: "model-a", requested_reasoning_effort: "low" as const }
      ],
      synthesizer: "codex_cli" as const,
      estimated_tokens: 50_000,
      arbitration_route: null
    };
    const arbitrationRoute = { provider: "agy_cli" as const, model: "model-a", reasoning_effort: "low" as const, estimated_tokens: 8_000 };

    await client.listBrainstorms();
    await client.getBrainstorm("bs/1");
    await client.createBrainstorm(draft);
    await client.approveBrainstorm("bs/1", "owner");
    await client.arbitrateBrainstorm("bs/1", "owner", arbitrationRoute);
    await client.cancelBrainstorm("bs/1");

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://cp/brainstorms", "http://cp/brainstorms/bs%2F1", "http://cp/brainstorms",
      "http://cp/brainstorms/bs%2F1/approve", "http://cp/brainstorms/bs%2F1/arbitrate", "http://cp/brainstorms/bs%2F1/cancel"
    ]);
    expect(JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string)).toEqual(draft);
    expect(JSON.parse(fetcher.mock.calls[3]?.[1]?.body as string)).toEqual({ operator: "owner" });
    expect(JSON.parse(fetcher.mock.calls[4]?.[1]?.body as string)).toEqual({ operator: "owner", route: arbitrationRoute });
    expect(JSON.parse(fetcher.mock.calls[5]?.[1]?.body as string)).toEqual({});
    expect(fetcher.mock.calls.every(([, init]) => init.credentials === "include")).toBe(true);
  });
});
