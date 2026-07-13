import { resolve } from "node:path";

import { performStateMaintenance } from "../src/data/delivery-system/stateMaintenance";

const arguments_ = process.argv.slice(2);
const apply = arguments_.includes("--apply");
const positional = arguments_.filter((argument) => argument !== "--apply");
const [stateDirectoryValue, backupDirectoryValue, environmentFileValue] = positional;
if (!stateDirectoryValue || !backupDirectoryValue || !environmentFileValue) {
  throw new Error("usage: tsx scripts/ops-maintenance.ts STATE_DIR BACKUP_DIR ENV_FILE [--apply]");
}
const report = performStateMaintenance({
  stateDirectory: resolve(stateDirectoryValue),
  backupDirectory: resolve(backupDirectoryValue),
  environmentFile: resolve(environmentFileValue),
  mode: apply ? "apply" : "dry_run"
});
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
