import React from "react";

export type StatusBadgeStatus = "running" | "waiting" | "blocked" | "completed" | "error" | "stale" | "unavailable";

const labels: Record<StatusBadgeStatus, string> = { running: "Běží", waiting: "Čeká", blocked: "Blokováno", completed: "Dokončeno", error: "Chyba", stale: "Zastaralé", unavailable: "Nedostupné" };

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return <span className={`status-badge status-${status}`} data-status={status} role="status">{labels[status]}</span>;
}
