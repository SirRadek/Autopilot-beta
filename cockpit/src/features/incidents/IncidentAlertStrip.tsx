import React from "react";
import type { AutopilotIncident } from "../../types/controlPlane";
import { formatRecordedAt, sortIncidentsNewestFirst } from "./incidentSelectors";

const severityRank: Readonly<Record<AutopilotIncident["severity"], number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export type IncidentAlertStripProps = {
  readonly incidents: readonly AutopilotIncident[];
  readonly onOpenDiagnostics: () => void;
};

export function IncidentAlertStrip({ incidents, onOpenDiagnostics }: IncidentAlertStripProps) {
  const open = sortIncidentsNewestFirst(incidents).filter((incident) => incident.status === "open");
  if (open.length === 0) return null;

  const newest = open[0];
  const topSeverity = open.reduce(
    (top, incident) => severityRank[incident.severity] > severityRank[top] ? incident.severity : top,
    newest.severity,
  );

  return (
    <div role="alert" className={`incident-alert-strip incident-alert-${topSeverity}`}>
      <strong>{open.length} otevřených incidentů</strong>
      <span className="incident-alert-summary">{newest.summary.slice(0, 120)}</span>
      <time dateTime={newest.recorded_at}>{formatRecordedAt(newest.recorded_at)}</time>
      <button type="button" onClick={onOpenDiagnostics}>Otevřít diagnostiku</button>
    </div>
  );
}
