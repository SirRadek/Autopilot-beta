import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { ResourcesView } from "./ResourcesView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(diagnosticsPane?: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const view = diagnosticsPane === undefined
    ? <ResourcesView providersPane={<p>PROVIDERS</p>} workersPane={<p>WORKERS</p>} sessionsPane={<p>SESSIONS</p>} projectsPane={<p>PROJECTS</p>} />
    : <ResourcesView providersPane={<p>PROVIDERS</p>} workersPane={<p>WORKERS</p>} sessionsPane={<p>SESSIONS</p>} projectsPane={<p>PROJECTS</p>} diagnosticsPane={diagnosticsPane} />;
  act(() => root.render(view));
  return { host, root };
}

describe("ResourcesView", () => {
  it("renders the resource sections under the capacity header", () => {
    const { host, root } = mount();
    expect(host.querySelector(".resources-header .eyebrow")?.textContent).toBe("Kapacita");
    expect(host.querySelector(".resources-header h2")?.textContent).toBe("Zdroje & zdraví");
    expect(host.textContent).toContain("PROVIDERS");
    expect(host.textContent).toContain("WORKERS");
    expect(host.textContent).toContain("SESSIONS");
    expect(host.textContent).toContain("PROJECTS");
    expect([...host.querySelectorAll(".resources-section h3")].map((heading) => heading.textContent?.trim())).toEqual([
      "Provideři & limity",
      "Workeři",
      "Sessions",
      "Projekty",
      "Diagnostika nástroje",
      "Rozdělení práce Planned",
      "MCP servery (cross) Planned",
    ]);
    act(() => root.unmount()); host.remove();
  });

  it("renders the provided diagnostics pane inside the diagnostics section", () => {
    const { host, root } = mount(<p>INCIDENTS</p>);
    const heading = [...host.querySelectorAll(".resources-section h3")]
      .find((candidate) => candidate.textContent === "Diagnostika nástroje");
    const section = heading?.closest("section");
    expect(section?.textContent).toContain("INCIDENTS");
    expect(section?.querySelector(".planned-note")).toBeNull();
    act(() => root.unmount()); host.remove();
  });

  it("renders the incident-data fallback when the diagnostics pane is omitted", () => {
    const { host, root } = mount();
    const heading = [...host.querySelectorAll(".resources-section h3")]
      .find((candidate) => candidate.textContent === "Diagnostika nástroje");
    const section = heading?.closest("section");
    expect(section?.querySelector(".planned-note")?.textContent).toBe("Bez dat o incidentech.");
    act(() => root.unmount()); host.remove();
  });

  it("marks exactly two planned cards without fake data", () => {
    const { host, root } = mount();
    const planned = [...host.querySelectorAll(".resources-section.planned")];
    expect(planned).toHaveLength(2);
    expect(planned.every((card) => card.querySelector(".planned-badge")?.textContent === "Planned")).toBe(true);
    expect(planned[0]?.textContent).toContain("Vyžaduje kapacitní routing na straně serveru.");
    expect(planned[1]?.textContent).toContain("Kanonická MCP konfigurace syncovaná do CLI — připravováno.");
    act(() => root.unmount()); host.remove();
  });
});
