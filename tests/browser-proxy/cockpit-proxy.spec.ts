import { expect, test } from "@playwright/test";

declare const location: { readonly origin: string };

const username = process.env.AUTOPILOT_PROXY_TEST_USERNAME ?? "";
const password = process.env.AUTOPILOT_PROXY_TEST_PASSWORD ?? "";
if (!username) throw new Error("AUTOPILOT_PROXY_TEST_USERNAME is required");
if (!password) throw new Error("AUTOPILOT_PROXY_TEST_PASSWORD is required");

test("uses the trusted same-origin proxy for the complete Cockpit login flow", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Uživatelské jméno").fill(username);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit" }).click();
  await expect(page.getByRole("heading", { name: "Hybrid Cockpit" })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource").every((entry) => new URL(entry.name).origin === location.origin))).toBe(true);

  const logoutStatus = await page.evaluate(async () => {
    const response = await fetch("/auth/logout", { method: "POST" });
    return response.status;
  });
  expect(logoutStatus).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Uživatelské jméno")).toBeVisible();
  await expect(page.getByLabel("Heslo")).toBeVisible();
});
