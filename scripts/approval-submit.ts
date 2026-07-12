import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import {
  createApprovalRecord,
  readApprovalQueue,
  writeApprovalQueue
} from "../src/data/delivery-system/approvalQueue";
import { assertTokenBudget } from "../src/data/delivery-system/tokenGateway";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}

const stateDir = required("state-dir");
const sessionId = required("session-id");
const vendor = required("vendor");
const promptFile = required("prompt-file");
const prompt = readFileSync(promptFile, "utf8");
const estimatedTokens = Number(args.get("estimated-tokens") ?? "0");
if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) throw new Error("invalid_estimated_tokens");
const maxTokens = args.get("max-tokens");
if (maxTokens !== undefined) assertTokenBudget({ estimatedTokens, budget: { max_tokens: Number(maxTokens), used_tokens: 0 } });

const record = createApprovalRecord({
  approvalId: args.get("id") ?? `approval-${randomUUID()}`,
  sessionId,
  vendor,
  ...(args.get("model") !== undefined ? { model: args.get("model") } : {}),
  skillIds: (args.get("skills") ?? "").split(",").map((skill) => skill.trim()).filter(Boolean),
  prompt,
  promptFile,
  estimatedTokens
});
const document = readApprovalQueue(stateDir);
writeApprovalQueue(stateDir, { ...document, records: [...document.records, record] });
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
