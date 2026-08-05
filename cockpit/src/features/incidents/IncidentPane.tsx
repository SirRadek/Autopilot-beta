import React, { useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import type { AutopilotIncident, AutopilotRepairPacket } from "../../types/controlPlane";
import {
  formatRecordedAt,
  MAX_VISIBLE_INCIDENTS,
  openIncidents,
  sortIncidentsNewestFirst,
} from "./incidentSelectors";

const MAX_PACKET_DISPLAY_CHARS = 8_000;

export type IncidentPaneProps = {
  readonly incidents: readonly AutopilotIncident[];
  readonly onAcknowledge: (incidentId: string) => Promise<unknown>;
  readonly onPrepareRepairPacket: (incidentId: string) => Promise<AutopilotRepairPacket>;
  readonly stale?: boolean;
  readonly refreshedAt?: string;
};

export function IncidentPane({ incidents, onAcknowledge, onPrepareRepairPacket, stale, refreshedAt }: IncidentPaneProps) {
  const [packet, setPacket] = useState<string>(); const [message, setMessage] = useState(""); const [pending, setPending] = useState<string>();
  const run = async (id: string, action: "acknowledge" | "packet") => { if (pending) return; setPending(`${action}:${id}`); setMessage(""); try { if (action === "acknowledge") { await onAcknowledge(id); setMessage("Incident byl potvrzen."); } else { const value = await onPrepareRepairPacket(id); const json = JSON.stringify(value, null, 2); setPacket(json); setMessage(json.length > MAX_PACKET_DISPLAY_CHARS ? "Balíček byl pouze pro zobrazení zkrácen; kopie zůstává úplná." : "Balíček je připraven pro ruční použití."); } } catch (error) { setMessage(error instanceof Error ? error.message.slice(0, 300) : "Akce incidentu selhala."); } finally { setPending(undefined); } };
  const copyPacket = async () => { if (!packet) return; await navigator.clipboard?.writeText(packet); setMessage("Balíček byl zkopírován pro ruční použití."); };
  const sorted = sortIncidentsNewestFirst(incidents);
  const visible = sorted.slice(0, MAX_VISIBLE_INCIDENTS);

  return <div className="incident-pane"><p className="manual-only">Pouze pro ruční použití v externí opravné relaci. Tato obrazovka nic nespouští.</p><div className="incident-pane-header"><span>{openIncidents(incidents).length} otevřených · {incidents.length} celkem</span>{stale ? <StatusBadge status="stale" /> : null}{refreshedAt ? <span>Obnoveno {formatRecordedAt(refreshedAt)}</span> : null}</div><ul>{visible.map((incident) => <li key={incident.incident_id}><header><strong>{incident.summary}</strong><span>{incident.severity}</span></header><p>{incident.stage} · {incident.impact}</p><small><time dateTime={incident.recorded_at}>{formatRecordedAt(incident.recorded_at)}</time> · {incident.incident_id} · {incident.retry_count} opakování</small><div className="incident-actions">{incident.status === "open" ? <button type="button" disabled={pending !== undefined} onClick={() => void run(incident.incident_id, "acknowledge")}>Potvrdit incident</button> : <span>Potvrzeno: {incident.acknowledged_by}{incident.acknowledged_at !== null ? <> · {formatRecordedAt(incident.acknowledged_at)}</> : null}</span>}<button type="button" disabled={pending !== undefined} onClick={() => void run(incident.incident_id, "packet")}>Připravit balíček pro opravu</button></div></li>)}</ul>{incidents.length > MAX_VISIBLE_INCIDENTS ? <p className="truncation-marker">Zobrazeno {MAX_VISIBLE_INCIDENTS} nejnovějších z {incidents.length} incidentů.</p> : null}<p aria-live="polite">{message}</p>{packet ? <section aria-label="Ruční balíček pro opravu"><button type="button" onClick={() => void copyPacket()}>Kopírovat balíček</button><pre>{packet.slice(0, MAX_PACKET_DISPLAY_CHARS)}{packet.length > MAX_PACKET_DISPLAY_CHARS ? "\n…" : ""}</pre></section> : null}</div>;
}
