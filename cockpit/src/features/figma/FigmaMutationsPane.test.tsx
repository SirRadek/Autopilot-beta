import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { FigmaMutationsPane } from "./FigmaMutationsPane";
import type { ControlPlaneClient } from "../../api/controlPlaneClient";
import type { FigmaMutationRecord } from "../../types/controlPlane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const record: FigmaMutationRecord = {
  id: "fm_1", status: "pending", created_at: "t", updated_at: "t",
  proposal: { source: { fileKey: "FK" }, briefHash: "a".repeat(64), expectedVersion: "v1", ops: [{ op: "createFrame" }], preview: { summary: "Create X" } },
};

function mount(client: Partial<ControlPlaneClient>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  return { host, root, client: client as ControlPlaneClient };
}

describe("FigmaMutationsPane", () => {
  it("lists pending proposals and surfaces a lease after approve", async () => {
    const decide = vi.fn().mockResolvedValue({ ...record, status: "approved", lease: "b".repeat(64) });
    const { host, root, client } = mount({ listFigmaMutations: vi.fn().mockResolvedValue([record]), decideFigmaMutation: decide });
    await act(async () => { root.render(<FigmaMutationsPane client={client} />); });
    expect(host.textContent).toContain("fm_1");
    expect(host.textContent).toContain("createFrame");

    const approve = [...host.querySelectorAll("button")].find((button) => button.textContent === "Schválit");
    await act(async () => { approve?.click(); });
    expect(decide).toHaveBeenCalledWith("fm_1", "approved");
    expect(host.querySelector(".fm-lease-value")?.textContent).toBe("b".repeat(64));
    act(() => root.unmount()); host.remove();
  });

  it("rejects a proposal and shows an empty state when there is nothing pending", async () => {
    const decide = vi.fn().mockResolvedValue({ ...record, status: "rejected" });
    const { host, root, client } = mount({ listFigmaMutations: vi.fn().mockResolvedValue([]), decideFigmaMutation: decide });
    await act(async () => { root.render(<FigmaMutationsPane client={client} />); });
    expect(host.textContent).toContain("Žádné návrhy ke schválení.");
    act(() => root.unmount()); host.remove();
  });
});
