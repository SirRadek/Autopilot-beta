import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RulesView } from "./RulesView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  act(() => root.render(<RulesView brainstormPane={<p>BRAINSTORM</p>} />));
  return { host, root };
}

describe("RulesView", () => {
  it("renders the brainstorm slot inside a titled card under the governance header", () => {
    const { host, root } = mount();
    expect(host.querySelector(".rules-header .eyebrow")?.textContent).toBe("Governance");
    expect(host.querySelector(".rules-header h2")?.textContent).toBe("Pravidla & Skills");
    expect(host.querySelector(".rules-section-brainstorm")?.textContent).toContain("BRAINSTORM");
    expect(host.querySelector(".rules-section-brainstorm h3")?.textContent).toBe("Brainstorm & fan-out");
    act(() => root.unmount()); host.remove();
  });

  it("marks exactly two planned cards without fake live data", () => {
    const { host, root } = mount();
    const planned = [...host.querySelectorAll(".rules-section.planned")];
    expect(planned).toHaveLength(2);
    expect(planned.every((card) => card.querySelector(".planned-badge")?.textContent === "Plánováno")).toBe(true);
    expect(planned[0]?.textContent).toContain("Živý stav pravidel z mesh: plánováno (bez endpointu).");
    expect(planned[1]?.textContent).toContain("Katalog skills a výběr pro jednotlivé běhy: plánováno. Skills se dnes vážou k běhům přes důkazy schválení.");
    act(() => root.unmount()); host.remove();
  });

  it("lists the four mesh rule categories as a static reference", () => {
    const { host, root } = mount();
    expect([...host.querySelectorAll(".rules-mesh-categories li")].map((item) => item.textContent)).toEqual([
      "Hranice běhu",
      "Routing & náklady",
      "Kvalita & dohled",
      "Obsah & design",
    ]);
    act(() => root.unmount()); host.remove();
  });
});
