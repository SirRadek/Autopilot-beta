import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { estimateBrainstormTokenEnvelope } from "../../src/data/delivery-system/brainstormBudget";
import {
  createBrainstorm,
  readBrainstormStore,
  replaceBrainstorm,
  type BrainstormRecord,
  type BrainstormRoute,
} from "../../src/data/delivery-system/brainstormStore";

const routes = [
  { provider: "codex_cli", model: "gpt-5", reasoning_effort: "high", estimated_tokens: 12_000 },
  { provider: "claude_cli", model: "sonnet", reasoning_effort: "high", estimated_tokens: 12_000 },
  { provider: "agy_cli", model: "gemini-pro", reasoning_effort: "high", estimated_tokens: 12_000 },
] as const satisfies readonly BrainstormRoute[];
const synthesizerRoute = { provider: "codex_cli", model: "gpt-5", reasoning_effort: "high", estimated_tokens: 10_000 } as const;
const arbitrationRoute = { provider: "claude_cli", model: "sonnet", reasoning_effort: "max", estimated_tokens: 8_000 } as const;
const fourRoutes = [
  ...routes,
  { provider: "openrouter_api", model: "google/gemini-2.5-pro", reasoning_effort: null, estimated_tokens: 12_000 },
] as const;
const now = "2026-07-22T10:00:00.000Z";
const stateDirs: string[] = [];

function stateDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "brainstorm-store-"));
  stateDirs.push(directory);
  return directory;
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    project_id: "autopilot-beta",
    brief: "Compare three independent implementation approaches.",
    routes: [...routes],
    synthesizer_route: synthesizerRoute,
    arbitration_route: arbitrationRoute,
    token_envelope: estimateBrainstormTokenEnvelope(routes, synthesizerRoute.estimated_tokens, arbitrationRoute.estimated_tokens),
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of stateDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("brainstorm store", () => {
  it("creates and atomically round-trips a durable draft", () => {
    const directory = stateDir();
    const record = createBrainstorm(directory, fixture(), now);

    expect(record).toMatchObject({
      schema_version: "v1",
      project_id: "autopilot-beta",
      routes,
      token_envelope: {
        fanout_tokens: 36_000,
        consolidation_tokens: 10_000,
        optional_arbitration_tokens: 8_000,
        minimum_tokens: 46_000,
        maximum_tokens: 54_000,
      },
      child_run_ids: [],
      consolidation_run_id: null,
      arbitration_run_id: null,
      conflicts: [],
      final_artifact: null,
      status: "draft",
      approved_by: null,
      created_at: now,
      updated_at: now,
    });
    expect(readBrainstormStore(directory).brainstorms).toEqual([record]);
    expect(readFileSync(join(directory, "brainstorms.json"), "utf8")).toBe(`${JSON.stringify({ schema_version: "v1", brainstorms: [record] }, null, 2)}\n`);
  });

  it("requires exactly three or four distinct fanout providers", () => {
    const directory = stateDir();
    expect(() => createBrainstorm(directory, fixture({ routes: routes.slice(0, 2) }), now)).toThrow("brainstorm_route_count");
    expect(() => createBrainstorm(directory, fixture({ routes: [routes[0], routes[0], routes[2]] }), now)).toThrow("brainstorm_provider_duplicate");
    expect(() => createBrainstorm(directory, fixture({ routes: [...routes, { ...routes[0], provider: "openrouter_api" }, { ...routes[1], provider: "openrouter_api" }] }), now)).toThrow("brainstorm_route_count");
  });

  it("round-trips the supported four-distinct-provider upper boundary", () => {
    const directory = stateDir();
    const record = createBrainstorm(directory, fixture({
      routes: fourRoutes,
      token_envelope: estimateBrainstormTokenEnvelope(fourRoutes, synthesizerRoute.estimated_tokens, arbitrationRoute.estimated_tokens),
    }), now);

    expect(record.routes).toEqual(fourRoutes);
    expect(readBrainstormStore(directory).brainstorms).toEqual([record]);
  });

  it("rejects provider-incompatible reasoning snapshots before persistence", () => {
    const directory = stateDir();
    expect(() => createBrainstorm(directory, fixture({
      routes: [routes[0], routes[1], { ...routes[2], reasoning_effort: "max" }],
    }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({
      synthesizer_route: { ...synthesizerRoute, provider: "agy_cli", reasoning_effort: "max" },
    }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({
      arbitration_route: { ...arbitrationRoute, provider: "openrouter_api", reasoning_effort: "high" },
    }), now)).toThrow("invalid_brainstorm");
    expect(readBrainstormStore(directory).brainstorms).toEqual([]);
  });

  it("rejects unknown fields, unsafe values, oversized briefs, and non-canonical envelopes", () => {
    const directory = stateDir();
    expect(() => createBrainstorm(directory, fixture({ surprise: true }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({ project_id: "../escape" }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({ brief: "x".repeat(32_001) }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({ routes: [{ ...routes[0], provider: "unknown" }, routes[1], routes[2]] }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({ routes: [{ ...routes[0], reasoning_effort: "extreme" }, routes[1], routes[2]] }), now)).toThrow("invalid_brainstorm");
    expect(() => createBrainstorm(directory, fixture({ token_envelope: { ...estimateBrainstormTokenEnvelope(routes, 10_000, 8_000), maximum_tokens: 1 } }), now)).toThrow("brainstorm_token_envelope_noncanonical");
  });

  it("replaces an existing validated record without changing its identity", () => {
    const directory = stateDir();
    const created = createBrainstorm(directory, fixture(), now);
    const replacement: BrainstormRecord = {
      ...created,
      status: "approved",
      approved_by: "owner-1",
      updated_at: "2026-07-22T10:01:00.000Z",
    };

    expect(replaceBrainstorm(directory, replacement)).toEqual(replacement);
    expect(readBrainstormStore(directory).brainstorms).toEqual([replacement]);
    expect(() => replaceBrainstorm(directory, { ...replacement, brainstorm_id: "missing" })).toThrow("brainstorm_not_found");
  });

  it("keeps the creation-time plan immutable during lifecycle replacement", () => {
    const directory = stateDir();
    const created = createBrainstorm(directory, fixture(), now);
    const mutations: readonly Partial<BrainstormRecord>[] = [
      { project_id: "other-project" },
      { brief: "A different brief" },
      { routes: created.routes.map((route, index) => index === 0 ? { ...route, model: "changed-model" } : route) },
      { synthesizer_route: { ...created.synthesizer_route, model: "changed-model" } },
      { arbitration_route: created.arbitration_route === null ? arbitrationRoute : { ...created.arbitration_route, model: "changed-model" } },
      { created_at: "2026-07-22T09:00:00.000Z" },
    ];

    for (const mutation of mutations) {
      expect(() => replaceBrainstorm(directory, { ...created, ...mutation })).toThrow("brainstorm_immutable_fields");
    }
    expect(readBrainstormStore(directory).brainstorms).toEqual([created]);
  });

  it("fails closed on corrupt, unknown, malformed, and non-canonical persisted state", () => {
    const directory = stateDir();
    const created = createBrainstorm(directory, fixture(), now);
    const path = join(directory, "brainstorms.json");
    const valid = { schema_version: "v1", brainstorms: [created] };
    const incompatibleRoute = {
      ...valid,
      brainstorms: [{
        ...created,
        routes: created.routes.map((route, index) => index === 2 ? { ...route, reasoning_effort: "max" } : route),
      }],
    };

    for (const document of [
      "{broken",
      JSON.stringify({ ...valid, unknown: true }),
      JSON.stringify({ ...valid, brainstorms: [{ ...created, unknown: true }] }),
      JSON.stringify({ ...valid, brainstorms: [{ ...created, status: "mystery" }] }),
      JSON.stringify({ ...valid, brainstorms: [{ ...created, token_envelope: { ...created.token_envelope, minimum_tokens: 1 } }] }),
      JSON.stringify(incompatibleRoute),
    ]) {
      writeFileSync(path, document);
      expect(() => readBrainstormStore(directory)).toThrow("invalid_brainstorm_store");
    }
  });

  it("rejects oversized persisted state before parsing", () => {
    const directory = stateDir();
    writeFileSync(join(directory, "brainstorms.json"), Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
    expect(() => readBrainstormStore(directory)).toThrow("invalid_brainstorm_store");
  });
});
