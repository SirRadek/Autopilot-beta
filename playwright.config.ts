import { defineConfig, devices } from "@playwright/test";

const browserStateDir = process.env.AUTOPILOT_BROWSER_STATE_DIR;
if (browserStateDir === undefined) throw new Error("AUTOPILOT_BROWSER_STATE_DIR is required; run npm run browser:qa");
const adminCredentialsPath = process.env.AUTOPILOT_BROWSER_ADMIN_CREDENTIALS_PATH;
if (adminCredentialsPath === undefined) throw new Error("AUTOPILOT_BROWSER_ADMIN_CREDENTIALS_PATH is required; run npm run browser:qa");
const username = process.env.AUTOPILOT_PROXY_TEST_USERNAME;
const password = process.env.AUTOPILOT_PROXY_TEST_PASSWORD;
if (!username) throw new Error("AUTOPILOT_PROXY_TEST_USERNAME is required");
if (!password) throw new Error("AUTOPILOT_PROXY_TEST_PASSWORD is required");

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
      command: "tsx scripts/control-plane-auth.ts set-admin-password && tsx scripts/control-plane-auth.ts issue-service-token \"$CONTROL_PLANE_STATE_DIR\" >/dev/null && tsx scripts/control-plane-server.ts",
      env: {
        CONTROL_PLANE_STATE_DIR: browserStateDir,
        CONTROL_PLANE_PORT: "8878",
        AUTOPILOT_ADMIN_CREDENTIALS_PATH: adminCredentialsPath,
        AUTOPILOT_ADMIN_USERNAME: username,
        AUTOPILOT_ADMIN_PASSWORD: password
      },
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
