import {
  decideApproval,
  readApprovalQueue,
  writeApprovalQueue
} from "../src/data/delivery-system/approvalQueue";

const command = process.argv[2];
const args = new Map<string, string>();
for (let index = 3; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const stateDir = args.get("state-dir");
if (!stateDir || !command || !["list", "approve", "reject"].includes(command)) {
  throw new Error("usage: tsx scripts/approval-queue.ts <list|approve|reject> --state-dir DIR [--id ID] [--reason TEXT]");
}

const document = readApprovalQueue(stateDir);
if (command === "list") {
  process.stdout.write(`${JSON.stringify(document.records, null, 2)}\n`);
} else {
  const approvalId = args.get("id");
  if (!approvalId) throw new Error("approval_id_required");
  const decision = command === "approve" ? "approved" : "rejected";
  const records = document.records.map((record) =>
    record.approval_id === approvalId
      ? decideApproval(record, decision, new Date().toISOString(), args.get("reason"))
      : record
  );
  if (!document.records.some((record) => record.approval_id === approvalId)) throw new Error("approval_not_found");
  writeApprovalQueue(stateDir, { ...document, records });
  process.stdout.write(`${JSON.stringify(records.find((record) => record.approval_id === approvalId), null, 2)}\n`);
}
