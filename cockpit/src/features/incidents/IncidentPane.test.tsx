import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AutopilotIncident, AutopilotRepairPacket } from "../../types/controlPlane";
import { IncidentPane } from "./IncidentPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const incident: AutopilotIncident = { incident_id: "incident-1", recorded_at: "2026-07-13T10:00:00Z", status: "open", acknowledged_at: null, acknowledged_by: null, severity: "high", stage: "cockpit", summary: "autopilot_internal_error", correlation_ids: { run_id: "run-1" }, impact: "Run inspection unavailable", retry_count: 2, event_refs: ["event-1"] };
const packet = { schema_version: "v1", intent: "external_autopilot_repair", execution: "manual", incident, expected: "Expected", actual: "Actual", reproduction_steps: [], verification_commands: [] } as AutopilotRepairPacket;

describe("IncidentPane", () => {
  it("renders an empty incident state when the collection is missing", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={undefined as never} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));

    expect(host.textContent).toContain("0 otevřených incidentů · 0 celkem");

    act(() => root.unmount()); host.remove();
  });

  it("uses Czech incident plurals and separates refreshed metadata", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={[incident]} refreshedAt="2026-08-05T22:26:50Z" onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));

    expect(host.querySelector(".incident-pane-header")?.textContent).toBe("1 otevřený incident · 1 celkem · Obnoveno 2026-08-05 22:26:50 UTC");

    act(() => root.render(<IncidentPane incidents={[incident, { ...incident, incident_id: "incident-2" }]} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));
    expect(host.querySelector(".incident-pane-header")?.textContent).toBe("2 otevřené incidenty · 2 celkem");

    act(() => root.unmount()); host.remove();
  });

  it("omits the incident detail line when its fields are absent", () => {
    const partial = { ...incident, stage: undefined, impact: "" } as unknown as AutopilotIncident;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={[partial]} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));

    expect(host.querySelector("li > p")).toBeNull();

    act(() => root.unmount()); host.remove();
  });

  it("acknowledges an incident and displays a manual repair packet without dispatch controls", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const onAcknowledge = vi.fn().mockResolvedValue({ ...incident, status: "acknowledged" }); const onPrepareRepairPacket = vi.fn().mockResolvedValue(packet);
    act(() => root.render(<IncidentPane incidents={[incident]} onAcknowledge={onAcknowledge} onPrepareRepairPacket={onPrepareRepairPacket} />));
    expect(host.textContent).toContain("autopilot_internal_error");
    await act(async () => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Potvrdit incident") as HTMLButtonElement).click()); expect(onAcknowledge).toHaveBeenCalledWith("incident-1");
    await act(async () => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Připravit balíček pro opravu") as HTMLButtonElement).click()); expect(onPrepareRepairPacket).toHaveBeenCalledWith("incident-1"); expect(host.textContent).toContain("external_autopilot_repair"); expect(host.textContent).toContain("Pouze pro ruční použití"); expect(host.textContent).not.toContain("Spustit opravu");
    act(() => root.unmount()); host.remove();
  });

  it("copies complete valid near-cap JSON while bounding only its display", async () => {
    const largePacket = { ...packet, actual: "x".repeat(63_000) }; const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(<IncidentPane incidents={[incident]} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn().mockResolvedValue(largePacket)} />));
    await act(async () => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Připravit balíček pro opravu") as HTMLButtonElement).click()); await act(async () => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Kopírovat balíček") as HTMLButtonElement).click());
    const copied = writeText.mock.calls[0]?.[0] as string; expect(JSON.parse(copied)).toEqual(largePacket); expect(copied.endsWith("}")).toBe(true); expect(host.querySelector("pre")?.textContent?.length).toBeLessThan(copied.length);
    act(() => root.unmount()); host.remove();
  });

  it("renders incidents newest first", () => {
    const older = { ...incident, incident_id: "incident-older", recorded_at: "2026-07-13T09:00:00Z", summary: "Starší incident" };
    const newer = { ...incident, incident_id: "incident-newer", recorded_at: "2026-07-13T11:00:00Z", summary: "Novější incident" };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={[older, newer]} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));
    expect([...host.querySelectorAll("li strong")].map((summary) => summary.textContent)).toEqual(["Novější incident", "Starší incident"]);
    act(() => root.unmount()); host.remove();
  });

  it("keeps the 64 newest incidents and reports truncation", () => {
    const incidents = Array.from({ length: 65 }, (_, index): AutopilotIncident => ({
      ...incident,
      incident_id: `incident-${index}`,
      recorded_at: new Date(Date.UTC(2026, 6, 13, 10, 0, index)).toISOString(),
      summary: index === 0 ? "Nejstarší skrytý incident" : `Incident ${index}`,
    }));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={incidents} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));
    expect(host.textContent).not.toContain("Nejstarší skrytý incident");
    expect(host.textContent).toContain("Zobrazeno 64 nejnovějších z 65 incidentů.");
    act(() => root.unmount()); host.remove();
  });

  it("renders recorded timestamps in the deterministic UTC format", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={[incident]} onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));
    expect(host.querySelector('time[datetime="2026-07-13T10:00:00Z"]')?.textContent).toBe("2026-07-13 10:00:00 UTC");
    act(() => root.unmount()); host.remove();
  });

  it("renders the stale status badge", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<IncidentPane incidents={[incident]} stale onAcknowledge={vi.fn()} onPrepareRepairPacket={vi.fn()} />));
    expect(host.querySelector('[data-status="stale"]')?.textContent).toBe("Zastaralé");
    act(() => root.unmount()); host.remove();
  });
});
