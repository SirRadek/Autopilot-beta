import { resolve } from "node:path";

import { createStateBackup, validateStateBackup } from "../src/data/delivery-system/stateBackup";

const [stateDirectory, backupDirectory] = process.argv.slice(2);
if (!stateDirectory || !backupDirectory) throw new Error("usage: tsx scripts/ops-backup.ts STATE_DIR BACKUP_DIR");
const backup = createStateBackup(resolve(stateDirectory), resolve(backupDirectory));
const validation = validateStateBackup(backup.path);
console.log(JSON.stringify({ ...backup, validation }, null, 2));
if (!validation.valid) process.exitCode = 1;
