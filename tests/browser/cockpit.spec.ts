import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const browserStateDir = process.env.AUTOPILOT_BROWSER_STATE_DIR;
if (browserStateDir === undefined) throw new Error("AUTOPILOT_BROWSER_STATE_DIR is required");
const username = process.env.AUTOPILOT_PROXY_TEST_USERNAME ?? "";
const password = process.env.AUTOPILOT_PROXY_TEST_PASSWORD ?? "";
if (!username) throw new Error("AUTOPILOT_PROXY_TEST_USERNAME is required");
if (!password) throw new Error("AUTOPILOT_PROXY_TEST_PASSWORD is required");

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Autopilot cockpit" })).toBeVisible();
  await page.getByLabel("Uživatelské jméno").fill(username);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit" }).click();
  await expect(page.getByRole("heading", { name: "Autopilot", exact: true, level: 1 })).toBeVisible();
}

async function goToView(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.getByRole("tab", { name: label }).click();
}

test("logs in and renders the protected cockpit destinations", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Command Center", level: 2 })).toBeVisible();
  await goToView(page, "Detail běhu");
  await expect(page.getByRole("heading", { name: "Propagace" })).toBeVisible();
  await goToView(page, "Zdroje & zdraví");
  await expect(page.getByRole("heading", { name: "Zdroje & zdraví", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workeři" }).getByText("Žádní běžící workeři.")).toBeVisible();
  await goToView(page, "Nový běh");
  await expect(page.getByRole("heading", { name: "Nový běh", level: 2 })).toBeVisible();
  await goToView(page, "Pravidla & Skills");
  await expect(page.getByRole("heading", { name: "Pravidla & Skills", level: 2 })).toBeVisible();
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
  // The approval queue lives in Command Center, which is the default landing view.
  await page.getByRole("button", { name: /codex \/ test-model/ }).click();
  await page.getByRole("button", { name: "Schválit" }).click();
  await expect(page.getByText("Schválit tento prompt ke spuštění?")).toBeVisible();

  await goToView(page, "Zdroje & zdraví");
  const sessions = page.getByRole("region", { name: "Relace" });
  await sessions.getByRole("combobox", { name: "Poskytovatel relace" }).selectOption("openrouter_api");
  const sessionResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/sessions" && response.request().method() === "POST");
  await sessions.getByRole("button", { name: "Vytvořit relaci" }).first().click();
  const createdResponse = await sessionResponse;
  expect(createdResponse.status()).toBe(201);
  expect(createdResponse.request().postDataJSON()).toEqual({ agent_command: "openrouter_api", cwd: "/home/radek/autopilot-beta" });
  const created = await createdResponse.json() as { readonly session_id: string };
  await expect(sessions.getByRole("button", { name: `Vybrat relaci ${created.session_id}` })).toBeVisible();
});

test("surfaces a provider stale/error state without breaking the shell", async ({ page }) => {
  await page.route("**/providers/health", (route) => route.abort("failed"));
  await page.route("**/providers/quotas", (route) => route.abort("failed"));
  await login(page);
  await expect(page.getByRole("heading", { name: "Autopilot", exact: true, level: 1 })).toBeVisible();
  await goToView(page, "Zdroje & zdraví");
  await expect(page.getByRole("region", { name: "Provideři & limity" }).getByText("Nedostupné", { exact: true }).first()).toBeVisible();
});

test("supports keyboard tab navigation on the responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await login(page);
  const tabs = page.getByRole("tablist", { name: "Cockpit sections" }).getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Detail běhu" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(tabs.nth(4)).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Pravidla & Skills" })).toBeVisible();
});

test("keeps the cockpit usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await expect(page.locator("body")).toHaveCSS("min-width", "320px");
  await expect(page.getByRole("tablist", { name: "Cockpit sections" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Command Center" })).toBeVisible();
  await page.screenshot({ path: "test-results/cockpit-mobile.png", fullPage: true });
});

test("prepares without a worker, approves, and inspects terminal evidence", async ({ page }) => {
  const now = "2026-07-13T10:00:00.000Z";
  let run: any;
  const draft = { run_id: "browser-run-1", revision: 1, project_id: "browser-project", prompt: "Inspect the governed path", provider: "codex_cli", model: "browser-model", input_token_bound: 25, output_token_allowance: 8_192, estimated_tokens: 8_217, requested_artifacts: ["text"], prompt_review_acknowledged: false, requested_reasoning_effort: "low", created_at: now };
  const record = (status: string) => ({ schema_version: "v1", current: draft, revisions: [draft], status, approved_revision: status === "draft" ? null : 1, approved_by: status === "draft" ? null : "cockpit-operator", approved_at: status === "draft" ? null : now, supervisor_task_id: status === "draft" ? null : "browser-task-1", worker_run_id: status === "completed" ? "browser-worker-1" : null, terminal_reason: null, token_reservation: status === "draft" ? null : { reservationId: "browser-reservation-1", reservedAt: now, totalTokens: 8_217, provider: "codex_cli", model: "browser-model", sessionId: "browser-run-1", handoffId: "run-handoff-browser-run-1-1", inputTokens: 25, outputTokens: 8_192 }, reservation_status: status === "draft" ? "none" : status === "completed" ? "settled" : "active", provider_result: status === "completed" ? { refused: false, reason: null, worker_run_id: "browser-worker-1", raw_output: "browser deterministic artifact", exit_code: 0, error_reason: null, lock_status: "acquired_supervisor_spawn" } : null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: status === "completed" ? [{ artifact_id: "text-browser-worker-1", type: "text", preview: "browser deterministic artifact", created_at: now }] : [], updated_at: now });
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api") && !["/status", "/sessions", "/approvals", "/workers", "/projects", "/runs", "/incidents", "/providers/quotas", "/providers/models", "/providers/health", "/observability/timeline"].some((item) => path.startsWith(item))) return route.fallback();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/projects") return json([{ schema_version: "v1", project_id: "browser-project", name: "Browser project", cwd: "/fixture", enabled: true }]);
    if (path === "/providers/quotas") return json({ providers: [{ provider: "codex_cli", source: "cli", fetched_at: now, observed_at: now, freshness: "fresh", next_poll_at: null, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 100, used: 0, remaining: 100, resets_at: null }, api_spend: null, currency: null, models: [{ model_id: "browser-model", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null }] });
    if (path === "/providers/models") return json({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: [{ model_id: "browser-model", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low"] }] }] });
    if (path === "/providers/health") return json({ fetched_at: now, freshness: "fresh", providers: [] });
    if (path === "/runs" && route.request().method() === "POST") { run = record("draft"); return json(run, 201); }
    if (path === "/runs/browser-run-1/approve") { run = record("completed"); return json(run); }
    if (path === "/runs") return json(run ? [run] : []);
    if (path === "/workers") return json(run?.status === "completed" ? [{ worker_run_id: "browser-worker-1", vendor: "codex_cli", model: "browser-model", session_id: "browser-run-1", status: "completed", started_at: now, finished_at: now, output: "browser deterministic artifact" }] : []);
    if (path === "/observability/timeline") return json({ summary: { events: 1, tokens: 7, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [{ at: now, source: "dispatch", event: "completed", session_id: "browser-run-1", handoff_id: "run-handoff-browser-run-1-1", worker_run_id: "browser-worker-1", provider: "codex_cli", model: "browser-model", tokens: 7, retries: 0, refused: false, cost_usd: 0, detail: "settled" }], limits: { files_scanned: 1, max_bytes_per_file: 1024, max_lines_per_file: 10, max_events: 100, truncated: false } });
    if (path === "/status") return json({ telemetry: { calls: 0, total_tokens: 0 } });
    return json([]);
  });
  await page.route("**/providers/models", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: [{ model_id: "browser-model", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low"] }] }] }) }));
  const modelsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/providers/models");
  await login(page);
  expect(await (await modelsResponse).json()).toMatchObject({ freshness: "fresh", models: [{ model_id: "browser-model" }] });
  await goToView(page, "Zdroje & zdraví");
  await expect(page.getByRole("region", { name: "Workeři" }).getByText("Žádní běžící workeři.")).toBeVisible();
  await goToView(page, "Nový běh");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("browser-model");
  await page.getByLabel("Prompt", { exact: true }).fill("Inspect the governed path");
  await page.getByRole("button", { name: "Připravit běh" }).click();
  await expect(page.getByText("Revize 1 připravena ke schválení")).toBeVisible();
  await goToView(page, "Zdroje & zdraví");
  await expect(page.getByRole("region", { name: "Workeři" }).getByText("Žádní běžící workeři.")).toBeVisible();
  await goToView(page, "Nový běh");
  await page.getByRole("button", { name: "Schválit a spustit" }).click();
  // Selecting the run in Command Center navigates the shell to the "Detail běhu" view.
  await goToView(page, "Command Center");
  await page.getByRole("button", { name: /browser-run-1/ }).click();
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
  // Incidents render under "Diagnostika nástroje" in the "Zdroje & zdraví" view.
  await goToView(page, "Zdroje & zdraví");
  const diagnostics = page.getByRole("region", { name: "Diagnostika nástroje" });
  await expect(diagnostics).toBeVisible();
  const incidentItem = diagnostics.getByRole("listitem").filter({ hasText: failureBody.incident_id });
  await expect(incidentItem).toContainText("operational_failure:control_plane_runs");
  await expect(incidentItem).toContainText(failureBody.incident_id);
  await expect(page.locator("body")).not.toContainText("secret-value");
  const repair = await page.evaluate(async ({ incidentId }) => { const response = await fetch(`/incidents/${incidentId}/repair-packet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected: "authorization: Bearer secret-value", actual: "password=secret-value" }) }); return { status: response.status, text: await response.text() }; }, { incidentId: failureBody.incident_id });
  expect(repair.status).toBe(200);
  const repairText = repair.text;
  expect(repairText).toContain("[REDACTED]");
  expect(repairText).not.toContain("secret-value");
  await incidentItem.getByRole("button", { name: "Připravit balíček pro opravu" }).click();
  const packet = diagnostics.getByLabel("Ruční balíček pro opravu").first();
  await expect(packet).toContainText("external_autopilot_repair");
  await expect(packet).not.toContainText("secret-value");
  await incidentItem.getByRole("button", { name: "Potvrdit incident" }).click();
  await expect(page.getByText("Incident byl potvrzen.")).toBeVisible();
  await page.reload();
  await goToView(page, "Zdroje & zdraví");
  const acknowledgedDiagnostics = page.getByRole("region", { name: "Diagnostika nástroje" });
  const acknowledgedIncident = acknowledgedDiagnostics.getByRole("listitem").filter({ hasText: failureBody.incident_id });
  await expect(acknowledgedIncident).toContainText("Potvrzeno: cockpit-operator");
  await expect(acknowledgedIncident).toContainText(failureBody.incident_id);
});

test("moves a reviewed DEV preview into an evidence-gated PROD draft without automatic publication", async ({ page }) => {
  const now = "2026-07-21T12:00:00.000Z";
  const project = { schema_version: "v1", project_id: "showcase", name: "Showcase", cwd: "/fixture/showcase", enabled: true };
  const draft = (profile: "dev" | "prod", status: "draft" | "completed") => ({
    schema_version: "v1",
    current: {
      run_id: profile === "dev" ? "dev-preview-1" : "prod-draft-1",
      revision: 1,
      project_id: project.project_id,
      prompt: "Prepare the showcase preview",
      provider: "openrouter_api",
      model: "free-model",
      input_token_bound: 8,
      output_token_allowance: 8_192,
      estimated_tokens: 8_220,
      requested_artifacts: ["text"],
      prompt_review_acknowledged: false,
      profile,
      requested_reasoning_effort: "low",
      promotion_packet_id: profile === "prod" ? "promotion-1" : null,
      created_at: now,
    },
    revisions: [],
    status,
    approved_revision: status === "completed" ? 1 : null,
    approved_by: status === "completed" ? "cockpit-operator" : null,
    approved_at: status === "completed" ? now : null,
    supervisor_task_id: status === "completed" ? "preview-task-1" : null,
    worker_run_id: status === "completed" ? "preview-worker-1" : null,
    terminal_reason: null,
    token_reservation: null,
    reservation_status: status === "completed" ? "settled" : "none",
    provider_result: null,
    cancellation_requested: false,
    queue_compensation_requested: false,
    dispatch_failure: null,
    retry_input_tokens: 0,
    retry_output_tokens: 0,
    artifacts: status === "completed" ? [{ artifact_id: "preview-artifact", type: "text", preview: "Preview ready", created_at: now }] : [],
    updated_at: now,
  });
  let devRun: ReturnType<typeof draft> | undefined;
  let prodRun: ReturnType<typeof draft> | undefined;
  let workerInvocations = 0;
  let packet: any;
  const packetState = (status: "promotion_pending" | "approved" | "published") => ({
    schema_version: "v1",
    packet_id: "promotion-1",
    source_run_id: "dev-preview-1",
    source_revision: 1,
    intent: "Publish showcase",
    artifact_hash: "a".repeat(64),
    artifact_ref: "artifact://dev-preview-1/1",
    diff_summary: "Reviewed preview",
    tests: ["npm run browser:qa"],
    risks: ["release"],
    approvals: status === "promotion_pending" ? [] : [{ approver: "owner", approved_at: now, review_ref: "review://promotion-1" }],
    prod_run_id: status === "published" ? "prod-draft-1" : null,
    full_verification_ref: status === "promotion_pending" ? null : packet?.full_verification_ref ?? null,
    release_acceptance_ref: status === "published" ? "acceptance://fixture" : null,
    rollback_ref: status === "published" ? "rollback://fixture" : null,
    status,
    created_at: now,
    updated_at: now,
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/__fixtures__/full-verification" && request.method() === "POST") {
      packet = { ...packetState("approved"), full_verification_ref: "verification://fixture/full" };
      return route.fulfill({ status: 204 });
    }
    if (path === "/__fixtures__/production-acceptance" && request.method() === "POST") {
      prodRun = draft("prod", "completed");
      packet = { ...packetState("published"), full_verification_ref: "verification://fixture/full" };
      return route.fulfill({ status: 204 });
    }
    if (!path.startsWith("/api") && !["/status", "/sessions", "/approvals", "/workers", "/projects", "/runs", "/promotions", "/incidents", "/providers/quotas", "/providers/models", "/providers/health", "/observability/timeline"].some((item) => path.startsWith(item))) return route.fallback();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/projects") return json([project]);
    if (path === "/providers/quotas") return json({ providers: [{ provider: "openrouter_api", source: "api", fetched_at: now, observed_at: now, freshness: "fresh", next_poll_at: null, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 100, used: 0, remaining: 100, resets_at: null }, api_spend: 0, currency: "USD", models: [{ model_id: "free-model", available: true, health: "healthy", source: "api" }], health: "healthy", error_code: null }] });
    if (path === "/providers/models") return json({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: [{ model_id: "free-model", providers: ["openrouter_api"], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: "openrouter_api", reasoning_efforts: ["low"] }] }] });
    if (path === "/providers/health") return json({ fetched_at: now, freshness: "fresh", providers: [] });
    if (path === "/runs" && request.method() === "POST") {
      const body = request.postDataJSON() as { profile: "dev" | "prod" };
      if (body.profile === "dev") { devRun = draft("dev", "draft"); return json(devRun, 201); }
      prodRun = draft("prod", "draft"); return json(prodRun, 201);
    }
    if (path === "/runs/dev-preview-1/approve") { workerInvocations += 1; devRun = draft("dev", "completed"); return json(devRun); }
    if (path === "/runs/dev-preview-1/promote") { packet = packetState("promotion_pending"); return json(packet, 201); }
    if (path === "/runs/dev-preview-1") return json(devRun);
    if (path === "/runs") return json(url.searchParams.get("profile") === "prod" ? (prodRun ? [prodRun] : []) : (devRun ? [devRun] : []));
    if (path === "/promotions/promotion-1/approve") { packet = packetState("approved"); return json(packet); }
    if (path === "/promotions/promotion-1/record-verification") { packet = { ...packetState("approved"), full_verification_ref: "verification://fixture/full" }; return json(packet); }
    if (path === "/promotions/promotion-1/mark-published") {
      const body = request.postDataJSON() as Record<string, unknown>;
      if (prodRun?.status !== "completed" || packet?.full_verification_ref !== "verification://fixture/full" || body.release_acceptance_ref !== "acceptance://fixture" || body.rollback_ref !== "rollback://fixture") return json({ error: "promotion_publish_evidence_required" }, 409);
      packet = { ...packetState("published"), full_verification_ref: "verification://fixture/full" };
      return json(packet);
    }
    if (path === "/promotions") return json({ packets: packet ? [packet] : [] });
    if (path === "/workers") return json(workerInvocations === 0 ? [] : [{ worker_run_id: "preview-worker-1", vendor: "openrouter_api", model: "free-model", session_id: "dev-preview-1", status: "completed", started_at: now, finished_at: now, output: "Preview ready" }]);
    if (path === "/observability/timeline") return json({ summary: { events: 1, tokens: 8, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 1, max_bytes_per_file: 1024, max_lines_per_file: 10, max_events: 100, truncated: false } });
    if (path === "/status") return json({ telemetry: { calls: workerInvocations, total_tokens: 8 } });
    return json([]);
  });

  await login(page);
  await goToView(page, "Nový běh");
  const newRunPanel = page.getByRole("tabpanel", { name: "Nový běh" });
  await expect(page.getByRole("tab", { name: "DEV" })).toHaveAttribute("aria-selected", "true");
  await expect(newRunPanel.getByRole("combobox", { name: "Projekt" })).toHaveValue(project.project_id);
  await expect(newRunPanel.getByRole("combobox", { name: "Poskytovatel" })).toHaveValue("openrouter_api");
  await expect(newRunPanel.getByRole("combobox", { name: "Model" })).toHaveValue("free-model");
  await expect(newRunPanel.getByText("Doporučení: žádné (shadow-only)")).toBeVisible();
  await page.getByLabel("Prompt", { exact: true }).fill("Prepare the showcase preview");
  await page.getByRole("button", { name: "Připravit běh" }).click();
  expect(workerInvocations).toBe(0);
  await page.getByRole("button", { name: "Schválit a spustit" }).click();
  // Promotion controls (Propagace) and the run inspector both live in Detail běhu; the composer
  // state and route.runId set by approval survive the view switch, so the run is auto-selected.
  await goToView(page, "Detail běhu");
  await expect(page.getByLabel("Artefakty").getByText("Preview ready")).toBeVisible();
  await page.getByLabel("Shrnutí diffu dev-preview-1").fill("Reviewed preview");
  await page.getByLabel("Testy dev-preview-1").fill("npm run browser:qa");
  await page.getByLabel("Rizika dev-preview-1").fill("release");
  await page.getByRole("button", { name: "Propagovat" }).click();
  await expect(page.getByText("promotion_pending")).toBeVisible();
  await page.getByRole("button", { name: "Schválit propagaci" }).click();
  await expect(page.getByRole("button", { name: "Připravit PROD draft" })).toBeDisabled();
  const incompletePublication = await page.evaluate(async () => {
    const response = await fetch("/promotions/promotion-1/mark-published", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    return response.status;
  });
  expect(incompletePublication).toBe(409);
  await expect(page.getByText("published")).toHaveCount(0);
  await page.evaluate(async () => {
    const response = await fetch("/__fixtures__/full-verification", { method: "POST" });
    if (!response.ok) throw new Error("fixture_verification_failed");
  });
  await page.getByRole("tab", { name: "PROD" }).click();
  await page.getByRole("tab", { name: "DEV" }).click();
  await expect(page.getByRole("button", { name: "Připravit PROD draft" })).toBeEnabled();
  const callsBeforeProdDraft = workerInvocations;
  await page.getByRole("button", { name: "Připravit PROD draft" }).click();
  await expect(page.getByRole("tab", { name: "PROD" })).toHaveAttribute("aria-selected", "true");
  expect(workerInvocations).toBe(callsBeforeProdDraft);
  // Preparing the PROD draft selects it as the current run; Detail běhu stays the active view
  // and now shows prod-draft-1 in draft status.
  await expect(page.getByText(/prod-draft-1 · revize/)).toBeVisible();
  await expect(page.getByText("stav Koncept")).toBeVisible();
  await page.evaluate(async () => {
    const response = await fetch("/__fixtures__/production-acceptance", { method: "POST" });
    if (!response.ok) throw new Error("fixture_publication_failed");
  });
  await page.getByRole("tab", { name: "DEV" }).click();
  await page.getByRole("tab", { name: "PROD" }).click();
  await expect(page.getByText("published")).toBeVisible();
  await expect(page.getByText("acceptance://fixture")).toBeVisible();
  await expect(page.getByText("rollback://fixture")).toBeVisible();
  await expect(page.getByRole("button", { name: "Připravit PROD draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /deploy|nasadit|publikovat/i })).toHaveCount(0);
});

test("drives a governed brainstorm from three-provider fan-out through precommitted arbitration to a completed artifact, and keeps PROD read-only", async ({ page }) => {
  const now = "2026-07-22T09:00:00.000Z";
  const project = { schema_version: "v1", project_id: "brainstorm-project", name: "Brainstorm project", cwd: "/fixture/brainstorm", enabled: true };
  const routeFixtures = [
    { provider: "codex_cli", model: "model-codex-x", preview: "Codex proposal: incremental rollout." },
    { provider: "claude_cli", model: "model-claude-x", preview: "Claude proposal: big-bang rollout." },
    { provider: "agy_cli", model: "model-agy-x", preview: "Agy proposal: canary rollout." },
  ] as const;
  const childRunIds = ["run-codex-1", "run-claude-1", "run-agy-1"] as const;
  const consolidationRunId = "run-consolidate-1";
  const arbitrationRunId = "run-arbiter-1";
  const consensus = ["Adopt phased rollout", "Add canary gate before full deploy"] as const;
  const confidence = 0.82;
  const finalArtifact = "Synthesized decision: adopt phased rollout with canary gate.";
  const brainstormId = "brainstorm-1";
  // Canonical allocation for a submitted maximum of 42,684 tokens across 3 fan-out routes +
  // synthesis + arbitration (5 shares): perRoute = floor(42684 / 5) = 8536, remainder 4 goes to
  // synthesis (8540); mirrors canonicalAllocation() in scripts/control-plane-brainstorms.ts.
  const perRouteTokens = 8_536;
  const synthesisTokens = 8_540;
  const tokenEnvelope = { fanout_tokens: perRouteTokens * 3, consolidation_tokens: synthesisTokens, optional_arbitration_tokens: perRouteTokens, minimum_tokens: perRouteTokens * 3 + synthesisTokens, maximum_tokens: perRouteTokens * 3 + synthesisTokens + perRouteTokens };
  const arbitrationRoute = { provider: "agy_cli", model: "model-agy-x", reasoning_effort: "low", estimated_tokens: perRouteTokens };

  const run = (runId: string, provider: string, model: string, preview: string, estimatedTokens: number) => ({
    schema_version: "v1",
    current: { run_id: runId, revision: 1, project_id: project.project_id, prompt: "Brainstorm child run", provider, model, input_token_bound: 8, output_token_allowance: 8_192, estimated_tokens: estimatedTokens, requested_artifacts: ["text"], prompt_review_acknowledged: false, requested_reasoning_effort: "low", created_at: now },
    revisions: [],
    status: "completed",
    approved_revision: 1,
    approved_by: "cockpit-operator",
    approved_at: now,
    supervisor_task_id: `task-${runId}`,
    worker_run_id: `worker-${runId}`,
    terminal_reason: null,
    token_reservation: null,
    reservation_status: "settled",
    provider_result: { refused: false, reason: null, worker_run_id: `worker-${runId}`, raw_output: preview, exit_code: 0, error_reason: null, lock_status: "acquired_supervisor_spawn" },
    cancellation_requested: false,
    queue_compensation_requested: false,
    dispatch_failure: null,
    retry_input_tokens: 0,
    retry_output_tokens: 0,
    artifacts: [{ artifact_id: `artifact-${runId}`, type: "text", preview, created_at: now }],
    updated_at: now,
  });
  expect(childRunIds).toHaveLength(routeFixtures.length);
  const childRuns = routeFixtures.map((route, index) => {
    const childRunId = childRunIds[index];
    if (childRunId === undefined) throw new Error(`missing childRunIds entry at index ${index}`);
    return run(childRunId, route.provider, route.model, route.preview, perRouteTokens);
  });
  const consolidationRun = run(consolidationRunId, "codex_cli", "model-codex-x", JSON.stringify({ consensus, confidence }), synthesisTokens);
  const arbitrationRun = run(arbitrationRunId, "agy_cli", "model-agy-x", "Arbiter ruling: proceed phased with canary gate.", perRouteTokens);
  const brainstormRuns = [...childRuns, consolidationRun, arbitrationRun];

  let brainstorm: any;
  let createCalls = 0;
  let approveCalls = 0;
  let arbitrateCalls = 0;
  const draftRecord = () => ({
    schema_version: "v1",
    brainstorm_id: brainstormId,
    project_id: project.project_id,
    brief: "Evaluate the scaling roadmap for Q3.",
    routes: routeFixtures.map((route) => ({ provider: route.provider, model: route.model, reasoning_effort: "low", estimated_tokens: perRouteTokens })),
    synthesizer_route: { provider: "codex_cli", model: "model-codex-x", reasoning_effort: "low", estimated_tokens: synthesisTokens },
    arbitration_route: arbitrationRoute,
    token_envelope: tokenEnvelope,
    child_run_ids: [],
    consolidation_run_id: null,
    arbitration_run_id: null,
    conflicts: [],
    final_artifact: null,
    status: "draft",
    revision: 1,
    approval_state: "none",
    orchestration_group_id: null,
    slots: [],
    approved_by: null,
    created_at: now,
    updated_at: now,
  });
  const needsArbitrationRecord = () => ({
    ...draftRecord(),
    child_run_ids: childRunIds,
    consolidation_run_id: consolidationRunId,
    conflicts: [{ conflict_id: "conflict-1", output_run_ids: ["run-codex-1", "run-claude-1"], summary: "Divergent rollout order", material: true }],
    status: "needs_arbitration",
    approval_state: "reserved",
    approved_by: "cockpit-operator",
  });
  const completedRecord = () => ({
    ...needsArbitrationRecord(),
    arbitration_run_id: arbitrationRunId,
    final_artifact: finalArtifact,
    status: "completed",
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api") && !["/status", "/sessions", "/approvals", "/workers", "/projects", "/runs", "/incidents", "/brainstorms", "/providers/quotas", "/providers/models", "/providers/health", "/observability/timeline"].some((item) => path.startsWith(item))) return route.fallback();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/projects") return json([project]);
    if (path === "/providers/quotas") return json({ providers: routeFixtures.map((route) => ({ provider: route.provider, source: "cli", fetched_at: now, observed_at: now, freshness: "fresh", next_poll_at: null, five_hour: { limit: 100, used: 0, remaining: 100, resets_at: null }, weekly: { limit: 100, used: 0, remaining: 100, resets_at: null }, api_spend: null, currency: null, models: [{ model_id: route.model, available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null })) });
    if (path === "/providers/models") return json({ fetched_at: now, freshness: "fresh", next_poll_at: null, models: routeFixtures.map((route) => ({ model_id: route.model, providers: [route.provider], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: route.provider, reasoning_efforts: ["low"] }] })) });
    if (path === "/providers/health") return json({ fetched_at: now, freshness: "fresh", providers: [] });
    if (path === "/runs") return json(approveCalls === 0 ? [] : brainstormRuns);
    if (path === "/workers") return json([]);
    if (path === "/observability/timeline") return json({ summary: { events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 0, max_bytes_per_file: 1024, max_lines_per_file: 10, max_events: 100, truncated: false } });
    if (path === "/status") return json({ telemetry: { calls: 0, total_tokens: 0 } });
    if (path === "/brainstorms" && request.method() === "POST") {
      createCalls += 1;
      brainstorm = draftRecord();
      return json(brainstorm, 201);
    }
    if (path === `/brainstorms/${brainstormId}/approve`) {
      approveCalls += 1;
      brainstorm = needsArbitrationRecord();
      return json(brainstorm);
    }
    if (path === `/brainstorms/${brainstormId}/arbitrate`) {
      arbitrateCalls += 1;
      const body = request.postDataJSON() as { operator: string; route: typeof arbitrationRoute };
      expect(body.route).toEqual(arbitrationRoute);
      brainstorm = completedRecord();
      return json(brainstorm);
    }
    if (path === "/brainstorms") return json(brainstorm ? [brainstorm] : []);
    return json([]);
  });

  await login(page);
  await goToView(page, "Pravidla & Skills");
  // Brainstorm now renders exactly once, inside the Pravidla & Skills view; its root section
  // already carries aria-label="Brainstorm", so no extra pane-scoping locator is needed.
  const workspace = page.getByRole("region", { name: "Brainstorm", exact: true });
  await expect(page.getByRole("tab", { name: "DEV" })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByRole("heading", { name: "Brainstorm", exact: true })).toBeVisible();

  await workspace.getByLabel("Brainstorm projekt").selectOption(project.project_id);
  await workspace.getByLabel("Brief").fill("Evaluate the scaling roadmap for Q3.");
  for (const route of routeFixtures) {
    await workspace.getByLabel(`Model ${route.provider}`, { exact: true }).selectOption(route.model);
    await workspace.getByLabel(`Reasoning ${route.provider}`, { exact: true }).selectOption("low");
  }
  await workspace.getByLabel("Syntezátor").selectOption("codex_cli");
  await workspace.getByLabel("Arbitr", { exact: true }).selectOption("agy_cli");
  await workspace.getByLabel("Model arbitra").selectOption("model-agy-x");
  await workspace.getByLabel("Reasoning arbitra").selectOption("low");

  await expect(workspace.getByText(/34\u{a0}148–42\u{a0}684 tokenů/u)).toBeVisible();

  const prepareButton = workspace.getByRole("button", { name: "Připravit brainstorm" });
  await expect(prepareButton).toBeEnabled();
  await prepareButton.click();
  await expect(workspace.getByText(`Brainstorm ${brainstormId} připraven ke schválení`)).toBeVisible();
  expect(createCalls).toBe(1);
  expect(approveCalls).toBe(0);
  expect(arbitrateCalls).toBe(0);

  await expect(workspace.getByText(/Uložený rozsah: 34\u{a0}148–42\u{a0}684 tokenů/u)).toBeVisible();

  const fanoutButton = workspace.getByRole("button", { name: "Spustit fan-out" });
  await expect(fanoutButton).toBeDisabled();
  await workspace.getByLabel("Potvrzuji maximální tokenový rozsah").check();
  await expect(fanoutButton).toBeEnabled();
  await fanoutButton.click();
  expect(approveCalls).toBe(1);

  const record = workspace.getByRole("article", { name: `Brainstorm ${brainstormId}` });
  await expect(record).toContainText("needs_arbitration");
  for (const route of routeFixtures) await expect(record).toContainText(`${route.provider} · ${route.model}`);
  await expect(record.getByLabel("Konsenzus a jistota")).toContainText(consensus[0]);
  await expect(record.getByLabel("Konsenzus a jistota")).toContainText(consensus[1]);
  await expect(record.getByLabel("Konsenzus a jistota")).toContainText("82 %");
  await expect(record.getByLabel("Konflikty")).toContainText("Divergent rollout order (materiální)");
  await expect(record.getByLabel("Precommitted arbiter")).toContainText("Předem určený arbitr: agy_cli · model-agy-x");

  // Switch to PROD before arbitrating: creation controls and the arbitration mutation button must disappear,
  // while the precommitted-arbiter evidence stays visible read-only.
  await page.getByRole("tab", { name: "PROD" }).click();
  await expect(workspace.getByLabel("Brief")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "Připravit brainstorm" })).toHaveCount(0);
  const prodRecord = workspace.getByRole("article", { name: `Brainstorm ${brainstormId}` });
  await expect(prodRecord).toContainText("needs_arbitration");
  await expect(prodRecord.getByLabel("Precommitted arbiter")).toContainText("Předem určený arbitr: agy_cli · model-agy-x");
  await expect(prodRecord.getByRole("button", { name: /arbitráž/i })).toHaveCount(0);

  await page.getByRole("tab", { name: "DEV" }).click();
  const arbitrateButton = record.getByRole("button", { name: "Vyvolat arbitráž" });
  await arbitrateButton.click();
  expect(arbitrateCalls).toBe(0);
  const confirmButton = record.getByRole("button", { name: "Potvrdit arbitráž" });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();
  await expect(record).toContainText("completed");
  expect(arbitrateCalls).toBe(1);

  await expect(record.getByLabel("Výsledek")).toContainText(finalArtifact);
  await expect(record.getByLabel("Výsledek")).toContainText(`Provenience: ${[...childRunIds, consolidationRunId, arbitrationRunId].join(", ")}`);

  await page.getByRole("tab", { name: "PROD" }).click();
  const finalProdRecord = workspace.getByRole("article", { name: `Brainstorm ${brainstormId}` });
  await expect(finalProdRecord).toContainText("completed");
  await expect(finalProdRecord.getByLabel("Výsledek")).toContainText(finalArtifact);
  await expect(finalProdRecord.getByRole("button", { name: /arbitráž/i })).toHaveCount(0);
  await expect(workspace.getByLabel("Brief")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "Připravit brainstorm" })).toHaveCount(0);
});
