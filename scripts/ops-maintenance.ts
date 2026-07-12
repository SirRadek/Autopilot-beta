import { resolve } from "node:path";

import {
  rotateStateLogs,
  scanOperationalSecrets,
  verifyOperationalPermissions
} from "../src/data/delivery-system/operationalHardening";

const arguments_ = process.argv.slice(2);
const apply = arguments_.includes("--apply-rotation");
const positional = arguments_.filter((argument) => argument !== "--apply-rotation");
const [stateDirectoryValue, environmentFileValue] = positional;
if (!stateDirectoryValue || !environmentFileValue) throw new Error("usage: tsx scripts/ops-maintenance.ts STATE_DIR ENV_FILE [--apply-rotation]");
const stateDirectory = resolve(stateDirectoryValue);
const environmentFile = resolve(environmentFileValue);
const permissions = verifyOperationalPermissions(stateDirectory, environmentFile);
const secrets = scanOperationalSecrets(stateDirectory);
const rotated = apply ? rotateStateLogs(stateDirectory) : [];
const report = { ok: permissions.length === 0 && secrets.length === 0, mode: apply ? "rotation_applied" : "dry_run", permissions, secrets, rotated };
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
