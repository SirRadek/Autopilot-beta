import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AutopilotIncident } from "../../types/controlPlane";
import { IncidentAlertStrip } from "./IncidentAlertStrip";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const incident: AutopilotIncident = {
  incident_id: "incident-1",
  recorded_at: "2026-07-13T10:00:00Z",
  status: "open",
  acknowledged_at: null,
  acknowledged_by: null,
  severity: "high",
  stage: "cockpit",
  summary: "Control Plane není dostupný",
  correlation_ids: { run_id: "run-1" },
  impact: "Cockpit nemůže načíst stav běhu",
  retry_count: 2,
  event_refs: ["event-1"],
};

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("IncidentAlertStrip", () => {
  it("renders nothing when every incident is acknowledged", () => {
    const acknowledged: AutopilotIncident = {
      ...incident,
      status: "acknowledged",
      acknowledged_at: "2026-07-13T10:05:00Z",
      acknowledged_by: "operator",
    };
    const { host, root } = mount(
      <IncidentAlertStrip incidents={[acknowledged]} onOpenDiagnostics={vi.fn()} />,
    );

    expect(host.querySelector('[role="alert"]')).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("renders the open count and newest open incident and opens diagnostics", () => {
    const older = {
      ...incident,
      incident_id: "incident-older",
      recorded_at: "2026-07-13T09:00:00Z",
      summary: "Starší otevřený incident",
    };
    const newer = {
      ...incident,
      incident_id: "incident-newer",
      recorded_at: "2026-07-13T11:00:00Z",
      summary: "Nejnovější otevřený incident",
    };
    const newestAcknowledged: AutopilotIncident = {
      ...incident,
      incident_id: "incident-acknowledged",
      recorded_at: "2026-07-13T12:00:00Z",
      status: "acknowledged",
      acknowledged_at: "2026-07-13T12:05:00Z",
      acknowledged_by: "operator",
      summary: "Nejnovější, ale potvrzený incident",
    };
    const onOpenDiagnostics = vi.fn();
    const { host, root } = mount(
      <IncidentAlertStrip
        incidents={[older, newestAcknowledged, newer]}
        onOpenDiagnostics={onOpenDiagnostics}
      />,
    );

    expect(host.querySelector("strong")?.textContent).toBe("2 otevřených incidentů");
    expect(host.querySelector(".incident-alert-summary")?.textContent).toBe(
      "Nejnovější otevřený incident",
    );
    expect(host.querySelector('time[datetime="2026-07-13T11:00:00Z"]')?.textContent).toBe(
      "2026-07-13 11:00:00 UTC",
    );

    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Otevřít diagnostiku",
    ) as HTMLButtonElement;
    act(() => button.click());
    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
  });

  it("uses the critical severity class when critical and high incidents are open", () => {
    const critical = {
      ...incident,
      incident_id: "incident-critical",
      recorded_at: "2026-07-13T09:00:00Z",
      severity: "critical" as const,
    };
    const high = {
      ...incident,
      incident_id: "incident-high",
      recorded_at: "2026-07-13T11:00:00Z",
      severity: "high" as const,
    };
    const { host, root } = mount(
      <IncidentAlertStrip incidents={[high, critical]} onOpenDiagnostics={vi.fn()} />,
    );

    expect(host.querySelector('[role="alert"]')?.classList.contains("incident-alert-critical")).toBe(
      true,
    );

    act(() => root.unmount());
    host.remove();
  });
});
