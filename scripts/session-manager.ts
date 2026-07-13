import { randomUUID } from "node:crypto";
import {
  cancelSession,
  createSessionRecord,
  readSessionRegistry,
  resumeSession,
  writeSessionRegistry
} from "../src/data/delivery-system/sessionRegistry";

const command = process.argv[2];
const args = new Map<string, string>();
for (let index = 3; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value !== undefined) args.set(key.slice(2), value);
}
const stateDir = args.get("state-dir");
if (!stateDir || !command || !["create", "list", "close", "resume"].includes(command)) throw new Error("usage: session-manager <create|list|close|resume> --state-dir DIR");
const document = readSessionRegistry(stateDir);

if (command === "list") process.stdout.write(`${JSON.stringify(document.sessions, null, 2)}\n`);
else if (command === "create") {
  const session = createSessionRecord({ sessionId: args.get("id") ?? `session-${randomUUID()}`, agentCommand: required("agent"), cwd: required("cwd"), ...(args.get("name") !== undefined ? { name: args.get("name") } : {}), ...(args.get("ttl") !== undefined ? { ownerExpiresAt: args.get("ttl") } : {}) });
  writeSessionRegistry(stateDir, { ...document, sessions: [...document.sessions, session] });
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
} else {
  const id = required("id");
  const now = new Date().toISOString();
  const sessions = document.sessions.map((session) => session.session_id === id
    ? command === "close" ? cancelSession(session, args.get("reason") ?? "closed_by_owner", now) : resumeSession(session, now)
    : session);
  if (!document.sessions.some((session) => session.session_id === id)) throw new Error("session_not_found");
  writeSessionRegistry(stateDir, { ...document, sessions });
  process.stdout.write(`${JSON.stringify(sessions.find((session) => session.session_id === id), null, 2)}\n`);
}

function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
