import { defineConfig, devices } from "@playwright/test";

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
      command: "CONTROL_PLANE_TOKEN=browser-test-token tsx scripts/control-plane-server.ts \"$(mktemp -d)\" 8878",
      url: "http://127.0.0.1:8878/health",
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "CONTROL_PLANE_PROXY_TARGET=http://127.0.0.1:8878 npm --prefix cockpit run dev -- --host 127.0.0.1 --port 4183",
      url: "http://127.0.0.1:4183",
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
