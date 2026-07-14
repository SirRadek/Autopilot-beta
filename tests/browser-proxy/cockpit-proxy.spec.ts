import { expect, test } from "@playwright/test";

declare const location: { readonly origin: string };

test("uses the trusted same-origin proxy for the complete Cockpit login flow", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Control Plane token").fill(process.env.AUTOPILOT_PROXY_TEST_TOKEN!);
  await page.getByRole("button", { name: "Přihlásit" }).click();
  await expect(page.getByRole("heading", { name: "Hybrid Cockpit" })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource").every((entry) => new URL(entry.name).origin === location.origin))).toBe(true);

  const logoutStatus = await page.evaluate(async () => {
    const response = await fetch("/auth/logout", { method: "POST" });
    return response.status;
  });
  expect(logoutStatus).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Control Plane token")).toBeVisible();
});
