import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { buildReadiness } from "../src/data/delivery-system/readiness";
import {
  drillStateRecovery,
  type RecoveryValidation
} from "../src/data/delivery-system/stateRecovery";
import { resolveConfiguredProjectRoot } from "../src/data/delivery-system/runtimePaths";
import { SupervisorQueue } from "../src/data/delivery-system/supervisorQueue";
import { defaultAdminCredentialsPath } from "../src/data/delivery-system/adminCredentials";
import { AuthSessionRegistry, authStateRoot } from "../src/data/delivery-system/authSessionRegistry";

const [archivePath] = process.argv.slice(2);
if (!archivePath || process.argv.length !== 3) {
  throw new Error("usage: tsx scripts/ops-recovery-drill.ts ARCHIVE");
}

const result = drillStateRecovery(resolve(archivePath), {
  validateRestoredState: validateRestoredState
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function validateRestoredState(stateDir: string): RecoveryValidation {
  let reconciled = false;
  try {
    new SupervisorQueue({ stateDir }).recover();
    reconciled = true;
  } catch {
    return { ready: false, reconciled: false, errors: ["reconciliation_failed"] };
  }
  const liveStateDir = resolve(
    process.env.AUTOPILOT_STATE_DIR?.trim() ||
    process.env.CONTROL_PLANE_STATE_DIR?.trim() ||
    join(homedir(), ".local", "state", "autopilot")
  );
  const authRegistry = new AuthSessionRegistry(authStateRoot(liveStateDir));
  const report = buildReadiness({
    stateDir,
    projectRoot: resolveConfiguredProjectRoot(),
    authToken: "recovery-drill-validation",
    adminCredentialsPath: defaultAdminCredentialsPath(),
    serviceTokenDigest: () => authRegistry.serviceTokenDigest(),
    secureCookies: false,
    secureCookiesRequired: false,
    providerCommands: {},
    openRouterConfigured: false
  });
  return {
    ready: report.ready,
    reconciled,
    errors: report.ready ? [] : ["readiness_failed"]
  };
}
