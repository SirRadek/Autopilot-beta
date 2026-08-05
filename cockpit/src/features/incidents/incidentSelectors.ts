import type { AutopilotIncident } from "../../types/controlPlane";

export const MAX_VISIBLE_INCIDENTS = 64;

export function czechIncidentCount(n: number): string {
  if (n === 1) return `${n} otevřený incident`;
  if (n >= 2 && n <= 4) return `${n} otevřené incidenty`;
  return `${n} otevřených incidentů`;
}

export function sortIncidentsNewestFirst(
  incidents: readonly AutopilotIncident[],
): readonly AutopilotIncident[] {
  return [...incidents].sort((left, right) => {
    if (left.recorded_at !== right.recorded_at) {
      return left.recorded_at < right.recorded_at ? 1 : -1;
    }
    if (left.incident_id === right.incident_id) return 0;
    return left.incident_id < right.incident_id ? 1 : -1;
  });
}

export function formatRecordedAt(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return "čas neznámý";
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function openIncidents(
  incidents: readonly AutopilotIncident[],
): readonly AutopilotIncident[] {
  return incidents.filter((incident) => incident.status === "open");
}
