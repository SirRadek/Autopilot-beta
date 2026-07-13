import { resolve } from "node:path";

import { createStateBackup } from "../src/data/delivery-system/operationalHardening";

const [stateDirectory, backupDirectory] = process.argv.slice(2);
if (!stateDirectory || !backupDirectory) throw new Error("usage: tsx scripts/ops-backup.ts STATE_DIR BACKUP_DIR");
console.log(JSON.stringify(createStateBackup(resolve(stateDirectory), resolve(backupDirectory)), null, 2));
