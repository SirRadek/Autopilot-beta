import { defineConfig, devices } from "@playwright/test";

const browserStateDir = process.env.AUTOPILOT_BROWSER_STATE_DIR;
if (browserStateDir === undefined) throw new Error("AUTOPILOT_BROWSER_STATE_DIR is required; run npm run browser:qa");

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: [
    {
      command: "tsx scripts/control-plane-server.ts",
      env: { CONTROL_PLANE_TOKEN: "browser-test-token", CONTROL_PLANE_STATE_DIR: browserStateDir, CONTROL_PLANE_PORT: "8878" },
      url: "http://127.0.0.1:8878/health",
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "npm --prefix cockpit run dev -- --host 127.0.0.1 --port 4183",
      env: { CONTROL_PLANE_PROXY_TARGET: "http://127.0.0.1:8878" },
      url: "http://127.0.0.1:4183",
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
