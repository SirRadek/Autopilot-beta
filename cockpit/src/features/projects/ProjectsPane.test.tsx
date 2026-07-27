import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ProjectEntry } from "../../types/controlPlane";
import { ProjectsPane } from "./ProjectsPane";

const projects: readonly ProjectEntry[] = [
  { schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true },
  { schema_version: "v1", project_id: "beta", name: "Beta", cwd: "/work/beta", enabled: false }
];

function change(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProjectsPane", () => {
  it("renders projects and reports selection", () => {
    const select = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(<ProjectsPane projects={projects} selectedProjectId="alpha" onSelect={select} onCreate={() => undefined} />));

    expect(host.textContent).toContain("Alpha");
    expect(host.textContent).toContain("Beta");
    expect(host.textContent).toContain("Vypnutý");
    expect(host.querySelector("[aria-pressed='true']")?.textContent).toContain("Alpha");
    act(() => host.querySelector<HTMLButtonElement>("[aria-label='Vybrat projekt Beta']")?.click());
    expect(select).toHaveBeenCalledWith("beta");

    act(() => root.unmount());
    host.remove();
  });

  it("submits and clears the new-project form", async () => {
    const create = vi.fn(async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<ProjectsPane projects={[]} onSelect={() => undefined} onCreate={create} error="Sessions unavailable" />));
    const name = host.querySelector<HTMLInputElement>("#project-name")!;
    const cwd = host.querySelector<HTMLInputElement>("#project-cwd")!;
    change(name, "Crypto Analyzer");
    change(cwd, "/work/crypto-analyzer");

    await act(async () => host.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(create).toHaveBeenCalledWith({
      name: "Crypto Analyzer",
      cwd: "/work/crypto-analyzer"
    });
    expect(name.value).toBe("");
    expect(cwd.value).toBe("");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("Sessions unavailable");

    act(() => root.unmount());
    host.remove();
  });
});
