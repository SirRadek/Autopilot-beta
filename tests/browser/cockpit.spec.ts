import { expect, test } from "@playwright/test";

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
  await expect(page.getByLabel("Live Operations and Provider").getByText("No provider data available.")).toBeVisible();
});

test("supports keyboard tab navigation on the responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await login(page);
  const tabs = page.getByRole("tab");
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
