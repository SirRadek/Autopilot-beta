import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const browserStateDir = "/tmp/autopilot-browser-qa-state";

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Autopilot cockpit" })).toBeVisible();
  await page.getByLabel("Control Plane token").fill("browser-test-token");
  await page.getByRole("button", { name: "Přihlásit" }).click();
  await expect(page.getByRole("heading", { name: "Hybrid Cockpit" })).toBeVisible();
}

test("logs in and renders the protected cockpit destinations", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Projects & Sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval & Workflow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Operations & Provider Budget" })).toBeVisible();
  await expect(page.getByLabel("Live Operations and Provider").getByText("No workers running.")).toBeVisible();
});

test("shows approval confirmation and performs a session mutation", async ({ page }) => {
  await page.route("**/approvals", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        schema_version: "v1",
        approval_id: "browser-approval",
        session_id: "browser-session",
        vendor: "codex",
        model: "test-model",
        skill_ids: [],
        prompt_preview: "Run browser QA",
        prompt_file: null,
        estimated_tokens: 42,
        status: "pending",
        created_at: "2026-07-11T00:00:00.000Z",
        decided_at: null,
        rejection_reason: null
      }])
    });
  });
  await login(page);
  await page.getByRole("button", { name: /codex \/ test-model/ }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approve this prompt for dispatch?")).toBeVisible();

  await page.getByRole("button", { name: "Create session" }).first().click();
  await expect(page.getByText(/session/).first()).toBeVisible();
});

test("surfaces a provider stale/error state without breaking the shell", async ({ page }) => {
  await page.route("**/providers/health", (route) => route.abort("failed"));
  await login(page);
  await expect(page.getByRole("heading", { name: "Hybrid Cockpit" })).toBeVisible();
  await expect(page.getByLabel("Provider Budget").getByText("Unavailable").first()).toBeVisible();
});

test("supports keyboard tab navigation on the responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await login(page);
  const tabs = page.getByRole("tablist", { name: "Cockpit sections" }).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Sessions" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(tabs.nth(3)).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Workers" })).toBeVisible();
});

test("keeps the cockpit usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await expect(page.locator("body")).toHaveCSS("min-width", "320px");
  await expect(page.getByRole("tablist", { name: "Cockpit sections" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Approval" })).toBeVisible();
  await page.screenshot({ path: "test-results/cockpit-mobile.png", fullPage: true });
});

test("prepares without a worker, approves, and inspects terminal evidence", async ({ page }) => {
  const now = "2026-07-13T10:00:00.000Z";
  let run: any;
  const draft = { run_id: "browser-run-1", revision: 1, project_id: "browser-project", prompt: "Inspect the governed path", provider: "codex_cli", model: "browser-model", estimated_tokens: 7, requested_artifacts: ["text"], created_at: now };
  const record = (status: string) => ({ schema_version: "v1", current: draft, revisions: [draft], status, approved_revision: status === "draft" ? null : 1, approved_by: status === "draft" ? null : "cockpit-operator", approved_at: status === "draft" ? null : now, supervisor_task_id: status === "draft" ? null : "browser-task-1", worker_run_id: status === "completed" ? "browser-worker-1" : null, terminal_reason: null, token_reservation: status === "draft" ? null : { reservationId: "browser-reservation-1", reservedAt: now, totalTokens: 7, provider: "codex_cli", model: "browser-model", sessionId: "browser-run-1", handoffId: "run-handoff-browser-run-1-1", inputTokens: 7, outputTokens: 0 }, reservation_status: status === "draft" ? "none" : status === "completed" ? "settled" : "active", provider_result: status === "completed" ? { refused: false, reason: null, worker_run_id: "browser-worker-1", raw_output: "browser deterministic artifact" } : null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, artifacts: status === "completed" ? [{ artifact_id: "text-browser-worker-1", type: "text", preview: "browser deterministic artifact", created_at: now }] : [], updated_at: now });
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api") && !["/status", "/sessions", "/approvals", "/workers", "/projects", "/runs", "/incidents", "/providers/quotas", "/providers/models", "/providers/health", "/observability/timeline"].some((item) => path.startsWith(item))) return route.fallback();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/projects") return json([{ schema_version: "v1", project_id: "browser-project", name: "Browser project", cwd: "/fixture", enabled: true }]);
    if (path === "/providers/quotas") return json({ providers: [{ provider: "codex_cli", source: "cli", fetched_at: now, observed_at: now, freshness: "fresh", next_poll_at: null, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 100, used: 0, remaining: 100, resets_at: null }, api_spend: null, currency: null, models: [{ model_id: "browser-model", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null }] });
    if (path === "/providers/models") return json({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: [{ model_id: "browser-model", providers: ["codex_cli"], available: true, health: ["healthy"] }] });
    if (path === "/providers/health") return json({ fetched_at: now, freshness: "fresh", providers: [] });
    if (path === "/runs" && route.request().method() === "POST") { run = record("draft"); return json(run, 201); }
    if (path === "/runs/browser-run-1/approve") { run = record("completed"); return json(run); }
    if (path === "/runs") return json(run ? [run] : []);
    if (path === "/workers") return json(run?.status === "completed" ? [{ worker_run_id: "browser-worker-1", vendor: "codex_cli", model: "browser-model", session_id: "browser-run-1", status: "completed", started_at: now, finished_at: now, output: "browser deterministic artifact" }] : []);
    if (path === "/observability/timeline") return json({ summary: { events: 1, tokens: 7, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [{ at: now, source: "dispatch", event: "completed", session_id: "browser-run-1", handoff_id: "run-handoff-browser-run-1-1", worker_run_id: "browser-worker-1", provider: "codex_cli", model: "browser-model", tokens: 7, retries: 0, refused: false, cost_usd: 0, detail: "settled" }], limits: { files_scanned: 1, max_bytes_per_file: 1024, max_lines_per_file: 10, max_events: 100, truncated: false } });
    if (path === "/status") return json({ telemetry: { calls: 0, total_tokens: 0 } });
    return json([]);
  });
  await page.route("**/providers/models", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: [{ model_id: "browser-model", providers: ["codex_cli"], available: true, health: ["healthy"] }] }) }));
  const modelsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/providers/models");
  await login(page);
  expect(await (await modelsResponse).json()).toMatchObject({ freshness: "fresh", models: [{ model_id: "browser-model" }] });
  await expect(page.getByLabel("Live Operations and Provider").getByText("No workers running.")).toBeVisible();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("browser-model");
  await page.getByLabel("Prompt").fill("Inspect the governed path");
  await page.getByRole("button", { name: "Připravit běh" }).click();
  await expect(page.getByText("Revize 1 připravena ke schválení")).toBeVisible();
  await expect(page.getByLabel("Live Operations and Provider").getByText("No workers running.")).toBeVisible();
  await page.getByRole("button", { name: "Schválit a spustit" }).click();
  await expect(page.getByRole("button", { name: /browser-run-1 · completed/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Časová osa" })).toBeVisible();
  await expect(page.getByLabel("Artefakty").getByText("browser deterministic artifact")).toBeVisible();
});

test("persists, redacts, exports, and acknowledges a real internal incident", async ({ page }) => {
  await login(page);
  writeFileSync(join(browserStateDir, "runs.json"), "not-json authorization: Bearer secret-value", "utf8");
  const failure = await page.evaluate(async () => { const response = await fetch("/runs"); return { status: response.status, body: await response.json() }; });
  expect(failure.status).toBe(500);
  const failureBody = failure.body as { error: string; incident_id: string };
  expect(failureBody.error).toBe("autopilot_internal_error");
  writeFileSync(join(browserStateDir, "runs.json"), `${JSON.stringify({ schema_version: "v1", runs: [] })}\n`, "utf8");
  await page.reload();
  await page.getByRole("tab", { name: "Chyby" }).click();
  await expect(page.getByText("Unexpected control plane route failure").first()).toBeVisible();
  await expect(page.getByText(failureBody.incident_id).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("secret-value");
  const repair = await page.evaluate(async ({ incidentId }) => { const response = await fetch(`/incidents/${incidentId}/repair-packet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected: "authorization: Bearer secret-value", actual: "password=secret-value" }) }); return { status: response.status, text: await response.text() }; }, { incidentId: failureBody.incident_id });
  expect(repair.status).toBe(200);
  const repairText = repair.text;
  expect(repairText).toContain("[REDACTED]");
  expect(repairText).not.toContain("secret-value");
  await page.getByRole("button", { name: "Připravit balíček pro opravu" }).first().click();
  const packet = page.getByLabel("Ruční balíček pro opravu").first();
  await expect(packet).toContainText("external_autopilot_repair");
  await expect(packet).not.toContainText("secret-value");
  await page.getByRole("button", { name: "Potvrdit incident" }).first().click();
  await expect(page.getByText("Incident byl potvrzen.")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Chyby" }).click();
  await expect(page.getByText("Potvrzeno: cockpit-operator").first()).toBeVisible();
  await expect(page.getByText(failureBody.incident_id).first()).toBeVisible();
});
