import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.AUTOPILOT_PROXY_BASE_URL;
if (baseURL !== "https://autopilot.local" && baseURL !== "https://autopilot.local:8443") {
  throw new Error("AUTOPILOT_PROXY_BASE_URL must be an approved Autopilot HTTPS origin");
}
if (!process.env.AUTOPILOT_PROXY_TEST_TOKEN) {
  throw new Error("AUTOPILOT_PROXY_TEST_TOKEN is required");
}

export default defineConfig({
  testDir: "./tests/browser-proxy",
  timeout: 30_000,
  use: {
    baseURL,
    ignoreHTTPSErrors: false,
    trace: "off",
    video: "off",
    screenshot: "off",
    ...devices["Desktop Chrome"],
  },
});
