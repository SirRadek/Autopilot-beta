import React from "react";

import type { SessionRecord } from "../../types/controlPlane";
import { groupSessionsByProject, getSessionDisplayState, type SessionDisplayState } from "./sessionSelectors";

export type SessionPaneProps = {
  readonly sessions: readonly SessionRecord[];
  readonly selectedSessionId?: string;
  readonly now?: Date;
  readonly onSelect?: (session: SessionRecord) => void;
  readonly onCreate?: (cwd?: string) => void;
  readonly onResume?: (session: SessionRecord) => void;
  readonly onClose?: (session: SessionRecord) => void;
};

const stateLabel: Record<SessionDisplayState, string> = { active: "Active", expired: "Expired", closed: "Closed" };
const stateClass: Record<SessionDisplayState, string> = { active: "session-state-active", expired: "session-state-expired", closed: "session-state-closed" };

function bounded(value: string, max = 32): string { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }

export function SessionPane({ sessions, selectedSessionId, now, onSelect, onCreate, onResume, onClose }: SessionPaneProps) {
  const groups = groupSessionsByProject(sessions, now);
  return <div className="session-pane">
    <div className="session-pane-header"><span className="session-count" aria-live="polite">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span><button type="button" aria-label="Create session" onClick={() => onCreate?.()}>＋</button></div>
    {groups.length === 0 ? <div className="session-empty"><p>No projects or sessions</p><button type="button" onClick={() => onCreate?.()}>Create session</button></div> : <div className="session-projects">
      {groups.map((group) => <section key={group.cwd} className="session-project" aria-labelledby={`project-${group.cwd}`}>
        <div className="session-project-heading"><h3 id={`project-${group.cwd}`} title={group.cwd}>{bounded(group.label)}</h3><button type="button" aria-label={`Create session for ${group.label}`} onClick={() => onCreate?.(group.cwd)}>＋</button></div>
        <ul>
          {[...group.active, ...group.expired, ...group.closed].map((session) => { const state = getSessionDisplayState(session, now); const label = session.name || session.session_id; return <li key={session.session_id} className={selectedSessionId === session.session_id ? "session-item selected" : "session-item"}>
            <button type="button" className="session-select" aria-label={`Select session ${label}`} aria-current={selectedSessionId === session.session_id ? "true" : undefined} onClick={() => onSelect?.(session)}>
              <span className="session-name" title={label}>{bounded(label)}</span><span className={`session-state ${stateClass[state]}`}>{stateLabel[state]}</span><span className="session-agent" title={session.agent_command}>{bounded(session.agent_command, 24)}</span>
            </button>
            <div className="session-actions">{state !== "active" ? <button type="button" aria-label={`Resume session ${label}`} onClick={() => onResume?.(session)}>Resume</button> : null}{state === "active" ? <button type="button" aria-label={`Close session ${label}`} onClick={() => onClose?.(session)}>Close</button> : null}</div>
          </li>; })}
        </ul>
      </section>)}
    </div>}
  </div>;
}
