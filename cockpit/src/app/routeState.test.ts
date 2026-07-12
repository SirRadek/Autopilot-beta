import { describe, expect, it, vi } from "vitest";
import { readRouteState, writeRouteState } from "./routeState";

describe("cockpit route state", () => {
  it("restores project and session from URL", () => { expect(readRouteState({ search: "?project=alpha&session=s-1" })).toEqual({ projectId: "alpha", sessionId: "s-1" }); });
  it("preserves unrelated query parameters when writing", () => { const replaceState = vi.fn(); writeRouteState({ projectId: "alpha", sessionId: "s-2" }, { pathname: "/", search: "?view=providers", hash: "#top" }, { replaceState }); expect(replaceState).toHaveBeenCalledWith(null, "", "/?view=providers&project=alpha&session=s-2#top"); });
});
