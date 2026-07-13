import React from "react";

export type StatusBadgeStatus = "running" | "waiting" | "blocked" | "completed" | "error" | "stale" | "unavailable";

const labels: Record<StatusBadgeStatus, string> = { running: "Running", waiting: "Waiting", blocked: "Blocked", completed: "Completed", error: "Error", stale: "Stale", unavailable: "Unavailable" };

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return <span className={`status-badge status-${status}`} data-status={status} role="status">{labels[status]}</span>;
}
