import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = mkdtempSync(join(tmpdir(), "autopilot-browser-qa-"));
const stateDir = join(runtimeDir, "state");
const adminCredentialsPath = join(runtimeDir, "admin-credentials.json");
mkdirSync(stateDir, { mode: 0o700 });
const marker = randomUUID();
const markerPath = join(runtimeDir, ".autopilot-browser-qa-owner");
writeFileSync(markerPath, `${marker}\n`, { mode: 0o600 });

const child = spawn(process.execPath, [join(process.cwd(), "node_modules", "@playwright", "test", "cli.js"), "test", "--config=playwright.config.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    AUTOPILOT_BROWSER_STATE_DIR: stateDir,
    AUTOPILOT_BROWSER_ADMIN_CREDENTIALS_PATH: adminCredentialsPath,
    // Self-contained default test admin identity (matches isolated-acceptance.sh); overridable.
    AUTOPILOT_PROXY_TEST_USERNAME: process.env.AUTOPILOT_PROXY_TEST_USERNAME ?? "acceptance-admin",
    AUTOPILOT_PROXY_TEST_PASSWORD: process.env.AUTOPILOT_PROXY_TEST_PASSWORD ?? "autopilot-acceptance-test"
  }
});

child.once("error", finishWithError);
child.once("exit", (code, signal) => {
  try {
    if (readFileSync(markerPath, "utf8") !== `${marker}\n`) throw new Error("browser_qa_state_owner_mismatch");
    rmSync(runtimeDir, { recursive: true });
  } catch (error) {
    finishWithError(error);
    return;
  }
  if (signal !== null) {
    console.error(`browser_qa_terminated:${signal}`);
    process.exitCode = 1;
  } else process.exitCode = code ?? 1;
});

function finishWithError(error: unknown): void {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
