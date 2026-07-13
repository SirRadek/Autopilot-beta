import { resolve } from "node:path";

import { restoreStateBackup } from "../src/data/delivery-system/operationalHardening";

const arguments_ = process.argv.slice(2);
const apply = arguments_.includes("--apply");
const positional = arguments_.filter((argument) => argument !== "--apply");
const [archivePath, targetDirectory] = positional;
if (!archivePath || !targetDirectory) throw new Error("usage: tsx scripts/ops-restore.ts ARCHIVE TARGET_DIR [--apply]");
const result = restoreStateBackup(resolve(archivePath), resolve(targetDirectory), { apply });
console.log(JSON.stringify({ ...result, mode: apply ? "applied_to_empty_target" : "validation_only" }, null, 2));
