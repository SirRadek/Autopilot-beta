import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { NewRunView } from "./NewRunView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(environment: "dev" | "prod" = "dev", composer: React.ReactNode = <p>COMPOSER</p>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  act(() => root.render(<NewRunView environment={environment} composer={composer} />));
  return { host, root };
}

function radios(host: HTMLElement) { return [...host.querySelectorAll<HTMLInputElement>('.autonomy-cards input[type="radio"]')]; }

describe("NewRunView", () => {
  it("frames the composer inside the wizard header and sections", () => {
    const { host, root } = mount();
    expect(host.querySelector(".new-run-header h2")?.textContent).toBe("Nový běh");
    expect(host.textContent).toContain("Řízení běhu");
    expect(host.textContent).toContain("Zadej co udělat; orchestrátor rozplánuje a rozdělí. Držíš mantinely.");
    expect(host.textContent).toContain("Zadání & orchestrace");
    expect(host.textContent).toContain("COMPOSER");
    expect(host.querySelector('aside[aria-label="Obálka běhu"]')).not.toBeNull();
    act(() => root.unmount()); host.remove();
  });

  it("offers three autonomy presets with Navrhovat preselected", () => {
    const { host, root } = mount();
    const cards = radios(host);
    expect(cards.map((card) => card.value)).toEqual(["propose", "safe_steps", "full"]);
    expect(host.textContent).toContain("Navrhovat");
    expect(host.textContent).toContain("Bezpečné kroky");
    expect(host.textContent).toContain("Plný autopilot");
    expect(cards.map((card) => card.checked)).toEqual([true, false, false]);
    expect([...host.querySelectorAll(".autonomy-card")].map((card) => card.querySelector(".autonomy-permission:last-child")?.textContent?.trim())).toEqual(["Publikovat ✗", "Publikovat ✗", "Publikovat ✗"]);
    act(() => root.unmount()); host.remove();
  });

  it("switches the selected autonomy preset and mirrors it in the envelope", () => {
    const { host, root } = mount();
    expect(host.querySelector(".run-envelope")?.textContent).toContain("Navrhovat");
    act(() => { radios(host)[2]?.click(); });
    expect(radios(host).map((card) => card.checked)).toEqual([false, false, true]);
    expect(host.querySelectorAll(".autonomy-card.selected")).toHaveLength(1);
    const envelope = host.querySelector(".run-envelope")?.textContent ?? "";
    expect(envelope).toContain("Plný autopilot");
    expect(envelope).toContain("workspace-write");
    act(() => root.unmount()); host.remove();
  });

  it("marks server-side autonomy enforcement as planned", () => {
    const { host, root } = mount();
    expect(host.querySelector(".autonomy-note")?.textContent).toContain("Vynucení autonomie na straně serveru: Planned.");
    act(() => root.unmount()); host.remove();
  });

  it("keeps the autonomy preset local — no composer remount or mutation surface", () => {
    const { host, root } = mount();
    act(() => { radios(host)[1]?.click(); });
    expect(host.textContent).toContain("COMPOSER");
    expect(host.querySelectorAll("form")).toHaveLength(0);
    act(() => root.unmount()); host.remove();
  });

  it("shows the dev-only notice when the composer is absent in prod", () => {
    const { host, root } = mount("prod", null);
    expect(host.textContent).toContain("Nové běhy jen v DEV.");
    expect(host.textContent).not.toContain("COMPOSER");
    expect(radios(host)).toHaveLength(3);
    act(() => root.unmount()); host.remove();
  });

  it("uses instance-scoped section ids", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<><NewRunView environment="dev" composer={null} /><NewRunView environment="dev" composer={null} /></>));
    const ids = [...host.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = [...new Set([...host.querySelectorAll<HTMLInputElement>('.autonomy-cards input[type="radio"]')].map((radio) => radio.name))];
    expect(names).toHaveLength(2);
    act(() => root.unmount()); host.remove();
  });
});
