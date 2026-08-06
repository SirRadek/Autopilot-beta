import React, { useState, type FormEvent } from "react";

import type { RunProvider, SessionRecord } from "../../types/controlPlane";
import { KNOWN_PROVIDERS } from "../providers/knownProviders";
import { czechSessionCount, groupSessionsByProject, getSessionDisplayState, type SessionDisplayState } from "./sessionSelectors";

export type SessionPaneProps = {
  readonly sessions: readonly SessionRecord[];
  readonly selectedSessionId?: string;
  readonly now?: Date;
  readonly onSelect?: (session: SessionRecord) => void;
  readonly onCreate?: (provider: RunProvider, cwd?: string) => void | Promise<void>;
  readonly onResume?: (session: SessionRecord) => void;
  readonly onClose?: (session: SessionRecord) => void;
};

const stateLabel: Record<SessionDisplayState, string> = { active: "Aktivní", expired: "Vypršela", closed: "Zavřená" };
const stateClass: Record<SessionDisplayState, string> = { active: "session-state-active", expired: "session-state-expired", closed: "session-state-closed" };

function bounded(value: string, max = 32): string { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }

export function SessionPane({ sessions, selectedSessionId, now, onSelect, onCreate, onResume, onClose }: SessionPaneProps) {
  const groups = groupSessionsByProject(sessions, now);
  const inferredProvider = KNOWN_PROVIDERS.find((provider) => groups.some((group) => group.active.some((session) => session.agent_command === provider))) ?? KNOWN_PROVIDERS[0];
  const [chosenProvider, setChosenProvider] = useState<RunProvider>();
  const [cwd, setCwd] = useState("");
  const provider = chosenProvider ?? inferredProvider;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate?.(provider, cwd || undefined);
  }

  return <div className="session-pane">
    <div className="session-pane-header"><span className="session-count" aria-live="polite">{czechSessionCount(sessions.length)}</span><form className="session-create" onSubmit={submit}>
      <label htmlFor="session-provider">Poskytovatel<select id="session-provider" aria-label="Poskytovatel relace" value={provider} onChange={(event) => setChosenProvider(event.target.value as RunProvider)}>{KNOWN_PROVIDERS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>
      <label htmlFor="session-cwd">Pracovní adresář<input id="session-cwd" name="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} /></label>
      <button type="submit" aria-label="Vytvořit relaci">＋</button>
    </form></div>
    {groups.length === 0 ? <div className="session-empty"><p>Žádné projekty ani relace</p><button type="button" onClick={() => { void onCreate?.(provider, cwd || undefined); }}>Vytvořit relaci</button></div> : <div className="session-projects">
      {groups.map((group) => <section key={group.cwd} className="session-project" aria-labelledby={`project-${group.cwd}`}>
        <div className="session-project-heading"><h3 id={`project-${group.cwd}`} title={group.cwd}>{bounded(group.label)}</h3><button type="button" aria-label={`Vytvořit relaci pro ${group.label}`} onClick={() => { void onCreate?.(provider, group.cwd); }}>＋</button></div>
        <ul>
          {[...group.active, ...group.expired, ...group.closed].map((session) => { const state = getSessionDisplayState(session, now); const label = session.name || session.session_id; return <li key={session.session_id} className={selectedSessionId === session.session_id ? "session-item selected" : "session-item"}>
            <button type="button" className="session-select" aria-label={`Vybrat relaci ${label}`} aria-current={selectedSessionId === session.session_id ? "true" : undefined} onClick={() => onSelect?.(session)}>
              <span className="session-name" title={label}>{bounded(label)}</span><span className={`session-state ${stateClass[state]}`}>{stateLabel[state]}</span><span className="session-agent" title={session.agent_command}>{bounded(session.agent_command, 24)}</span>
            </button>
            <div className="session-actions">{state !== "active" ? <button type="button" aria-label={`Obnovit relaci ${label}`} onClick={() => onResume?.(session)}>Obnovit</button> : null}{state === "active" ? <button type="button" aria-label={`Zavřít relaci ${label}`} onClick={() => onClose?.(session)}>Zavřít</button> : null}</div>
          </li>; })}
        </ul>
      </section>)}
    </div>}
  </div>;
}
