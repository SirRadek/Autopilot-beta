import React, { useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import type { AutopilotIncident, AutopilotRepairPacket } from "../../types/controlPlane";
import {
  czechIncidentCount,
  formatRecordedAt,
  MAX_VISIBLE_INCIDENTS,
  openIncidents,
  sortIncidentsNewestFirst,
} from "./incidentSelectors";

const MAX_PACKET_DISPLAY_CHARS = 8_000;

function incidentDetail(incident: AutopilotIncident): string | undefined {
  const parts = [incident.stage, incident.impact]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export type IncidentPaneProps = {
  readonly incidents: readonly AutopilotIncident[];
  readonly onAcknowledge: (incidentId: string) => Promise<unknown>;
  readonly onPrepareRepairPacket: (incidentId: string) => Promise<AutopilotRepairPacket>;
  readonly stale?: boolean;
  readonly refreshedAt?: string;
};

export function IncidentPane({ incidents, onAcknowledge, onPrepareRepairPacket, stale, refreshedAt }: IncidentPaneProps) {
  const incidentEntries = (Array.isArray(incidents) ? incidents : []).filter((incident) => typeof incident === "object" && incident !== null);
  const [packet, setPacket] = useState<string>(); const [message, setMessage] = useState(""); const [pending, setPending] = useState<string>();
  const run = async (id: string, action: "acknowledge" | "packet") => { if (pending) return; setPending(`${action}:${id}`); setMessage(""); try { if (action === "acknowledge") { await onAcknowledge(id); setMessage("Incident byl potvrzen."); } else { const value = await onPrepareRepairPacket(id); const json = JSON.stringify(value, null, 2); setPacket(json); setMessage(json.length > MAX_PACKET_DISPLAY_CHARS ? "Balíček byl pouze pro zobrazení zkrácen; kopie zůstává úplná." : "Balíček je připraven pro ruční použití."); } } catch (error) { setMessage(error instanceof Error ? error.message.slice(0, 300) : "Akce incidentu selhala."); } finally { setPending(undefined); } };
  const copyPacket = async () => { if (!packet) return; await navigator.clipboard?.writeText(packet); setMessage("Balíček byl zkopírován pro ruční použití."); };
  const sorted = sortIncidentsNewestFirst(incidentEntries);
  const visible = sorted.slice(0, MAX_VISIBLE_INCIDENTS);

  return <div className="incident-pane"><p className="manual-only">Pouze pro ruční použití v externí opravné relaci. Tato obrazovka nic nespouští.</p><div className="incident-pane-header"><span>{czechIncidentCount(openIncidents(incidentEntries).length)} · {incidentEntries.length} celkem</span>{stale ? <> · <StatusBadge status="stale" /></> : null}{refreshedAt ? <> · <span>Obnoveno {formatRecordedAt(refreshedAt)}</span></> : null}</div><ul>{visible.map((incident) => {
    const detail = incidentDetail(incident);
    return <li key={incident.incident_id}><header><strong>{incident.summary}</strong><span>{incident.severity}</span></header>{detail === undefined ? null : <p>{detail}</p>}<small><time dateTime={incident.recorded_at}>{formatRecordedAt(incident.recorded_at)}</time> · {incident.incident_id} · {incident.retry_count} opakování</small><div className="incident-actions">{incident.status === "open" ? <button type="button" disabled={pending !== undefined} onClick={() => void run(incident.incident_id, "acknowledge")}>Potvrdit incident</button> : <span>Potvrzeno: {incident.acknowledged_by}{incident.acknowledged_at !== null ? <> · {formatRecordedAt(incident.acknowledged_at)}</> : null}</span>}<button type="button" disabled={pending !== undefined} onClick={() => void run(incident.incident_id, "packet")}>Připravit balíček pro opravu</button></div></li>;
  })}</ul>{incidentEntries.length > MAX_VISIBLE_INCIDENTS ? <p className="truncation-marker">Zobrazeno {MAX_VISIBLE_INCIDENTS} nejnovějších z {incidentEntries.length} incidentů.</p> : null}<p aria-live="polite">{message}</p>{packet ? <section aria-label="Ruční balíček pro opravu"><button type="button" onClick={() => void copyPacket()}>Kopírovat balíček</button><pre>{packet.slice(0, MAX_PACKET_DISPLAY_CHARS)}{packet.length > MAX_PACKET_DISPLAY_CHARS ? "\n…" : ""}</pre></section> : null}</div>;
}
