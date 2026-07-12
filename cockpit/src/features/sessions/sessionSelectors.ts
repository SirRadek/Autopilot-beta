import type { SessionRecord } from "../../types/controlPlane";

export type SessionDisplayState = "active" | "expired" | "closed";

export type SessionProjectGroup = {
  readonly cwd: string;
  readonly label: string;
  readonly active: readonly SessionRecord[];
  readonly expired: readonly SessionRecord[];
  readonly closed: readonly SessionRecord[];
};

export function getSessionDisplayState(session: SessionRecord, now = new Date()): SessionDisplayState {
  if (session.status === "closed") return "closed";
  if (session.owner_expires_at && new Date(session.owner_expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

function projectLabel(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts.at(-1) || cwd;
}

export function groupSessionsByProject(sessions: readonly SessionRecord[], now = new Date()): SessionProjectGroup[] {
  const groups = new Map<string, { active: SessionRecord[]; expired: SessionRecord[]; closed: SessionRecord[] }>();
  for (const session of sessions) {
    const group = groups.get(session.cwd) ?? { active: [], expired: [], closed: [] };
    group[getSessionDisplayState(session, now)].push(session);
    groups.set(session.cwd, group);
  }
  return [...groups.entries()].map(([cwd, group]) => ({ cwd, label: projectLabel(cwd), ...group }));
}
