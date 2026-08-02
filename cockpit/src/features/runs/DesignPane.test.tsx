import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { DesignPane, extractFigmaUrl } from "./DesignPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("DesignPane", () => {
  it("extracts a Figma frame url from prompt text", () => {
    expect(extractFigmaUrl("Build this: https://www.figma.com/design/ABC/Cockpit?node-id=42-7 with tests")).toBe("https://www.figma.com/design/ABC/Cockpit?node-id=42-7");
    expect(extractFigmaUrl("no link here")).toBeUndefined();
    expect(extractFigmaUrl(undefined)).toBeUndefined();
  });

  it("embeds the Figma url in an iframe when present", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<DesignPane figmaUrl="https://www.figma.com/design/ABC/Cockpit?node-id=42-7" />));
    const frame = host.querySelector("iframe.design-pane-frame") as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toContain("figma.com/embed?embed_host=autopilot-cockpit");
    expect(frame?.getAttribute("src")).toContain(encodeURIComponent("https://www.figma.com/design/ABC/Cockpit?node-id=42-7"));
    act(() => root.unmount()); host.remove();
  });

  it("shows an empty state without a linked design", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<DesignPane />));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("není připojený Figma design");
    act(() => root.unmount()); host.remove();
  });
});
