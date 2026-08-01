import { describe, expect, it, vi } from "vitest";
import { readRouteState, writeRouteState } from "./routeState";

describe("cockpit route state", () => {
  it("restores project and session from URL with a safe DEV default", () => { expect(readRouteState({ search: "?project=alpha&session=s-1" })).toEqual({ environment: "dev", projectId: "alpha", sessionId: "s-1", runId: undefined, view: "command" }); });
  it("preserves unrelated query parameters when writing", () => { const replaceState = vi.fn(); writeRouteState({ environment: "prod", projectId: "alpha", sessionId: "s-2" }, { pathname: "/", search: "?debug=1", hash: "#top" }, { replaceState }); expect(replaceState).toHaveBeenCalledWith(null, "", "/?debug=1&environment=prod&project=alpha&session=s-2#top"); });
  it("restores a known cockpit view and falls back to the command center", () => {
    expect(readRouteState({ search: "?view=resources" }).view).toBe("resources");
    expect(readRouteState({ search: "?view=new-run" }).view).toBe("new-run");
    expect(readRouteState({ search: "?view=providers" }).view).toBe("command");
    expect(readRouteState({ search: "" }).view).toBe("command");
  });
  it("writes only non-default views and clears the parameter for the command center", () => {
    const replaceState = vi.fn();
    writeRouteState({ environment: "dev", view: "rules" }, { pathname: "/", search: "", hash: "" }, { replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?environment=dev&view=rules");
    writeRouteState({ environment: "dev", view: "command" }, { pathname: "/", search: "?view=rules", hash: "" }, { replaceState });
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/?environment=dev");
  });
});
