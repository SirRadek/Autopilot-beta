import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ThrowingChild() {
  throw new Error("citlivý interní detail");
}

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host, { onCaughtError: () => undefined });
  act(() => root.render(node));
  return { host, root };
}

describe("ErrorBoundary", () => {
  it("renders a healthy child normally", () => {
    const { host, root } = mount(<ErrorBoundary><p>Zdravý obsah</p></ErrorBoundary>);

    expect(host.textContent).toBe("Zdravý obsah");

    act(() => root.unmount());
    host.remove();
  });

  it("renders bounded Czech fallback copy without exposing error internals", () => {
    const { host, root } = mount(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Tuto část Cockpitu se nepodařilo zobrazit.");
    expect(host.textContent).not.toContain("citlivý interní detail");

    act(() => root.unmount());
    host.remove();
  });
});
