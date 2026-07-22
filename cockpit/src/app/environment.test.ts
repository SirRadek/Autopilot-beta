import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { EnvironmentProvider, useCockpitEnvironment } from "./environment";

describe("cockpit environment", () => {
  it("exposes the selected environment to the shared app tree", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    function Region() { return React.createElement("section", { role: "region" }, useCockpitEnvironment()); }
    act(() => root.render(React.createElement(EnvironmentProvider, { environment: "prod" }, React.createElement(Region))));
    expect(host.querySelector("[role=region]")?.textContent).toBe("prod");
    act(() => root.unmount());
  });
});
