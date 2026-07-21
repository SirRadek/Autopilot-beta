import { describe, expect, it, vi } from "vitest";
import { readRouteState, writeRouteState } from "./routeState";

describe("cockpit route state", () => {
  it("restores project and session from URL with a safe DEV default", () => { expect(readRouteState({ search: "?project=alpha&session=s-1" })).toEqual({ environment: "dev", projectId: "alpha", sessionId: "s-1", runId: undefined }); });
  it("preserves unrelated query parameters when writing", () => { const replaceState = vi.fn(); writeRouteState({ environment: "prod", projectId: "alpha", sessionId: "s-2" }, { pathname: "/", search: "?view=providers", hash: "#top" }, { replaceState }); expect(replaceState).toHaveBeenCalledWith(null, "", "/?view=providers&environment=prod&project=alpha&session=s-2#top"); });
});
