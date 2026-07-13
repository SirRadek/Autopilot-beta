import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  acknowledgeIncident,
  prepareRepairPacket,
  readIncidentStore,
  recordAutopilotIncident
} from "../../src/data/delivery-system/incidentStore";

const incidentInput = (summary = "Authorization: Bearer secret-value") => ({
  severity: "high" as const,
  stage: "dispatch",
  summary,
  correlation_ids: { run_id: "run-1" },
  impact: "run failed",
  retry_count: 1,
  event_refs: ["event-1"]
});

describe("Autopilot incident store", () => {
  it("exports a redacted read-only packet and supports acknowledgement", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-store-"));
    const incident = recordAutopilotIncident(stateDir, incidentInput());
    const packet = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: "queued",
      actual: "failed Authorization: Bearer packet-secret",
      reproduction_steps: ["inspect Authorization: Bearer reproduction-secret"],
      verification_commands: ["npm test -- tests/delivery-system/run-orchestrator.test.ts"]
    });

    expect(JSON.stringify(packet)).not.toMatch(/secret-value|packet-secret|reproduction-secret/);
    expect(packet).toMatchObject({
      intent: "external_autopilot_repair",
      execution: "manual",
      incident: { incident_id: incident.incident_id, summary: "Authorization: Bearer [REDACTED]" }
    });
    expect(Object.keys(packet)).not.toContain("dispatch");
    expect(acknowledgeIncident(stateDir, incident.incident_id, "owner").status).toBe("acknowledged");
    expect(readIncidentStore(stateDir).incidents[0]?.acknowledged_by).toBe("owner");
  });

  it("redacts governed secret classes from every incident and packet surface", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-secret-classes-"));
    const privateKey = "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----";
    const incident = recordAutopilotIncident(stateDir, {
      ...incidentInput("password=hunter2"),
      impact: "AWS key AKIA1234567890ABCDEF",
      correlation_ids: { api_key: "api_key=provider-secret" },
      event_refs: [privateKey, "private_key=inline-private-material", "token sk-or-v1-abcdefghijk"]
    });
    const packet = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: "access_token=access-secret",
      actual: "refresh_token: refresh-secret",
      reproduction_steps: ["client_secret='client-secret'"],
      verification_commands: ["curl -H 'Cookie: session=cookie-secret; secondary=second-cookie-secret'", "Set-Cookie: auth=set-cookie-secret"]
    });
    const exported = JSON.stringify(packet);

    expect(exported).not.toMatch(/hunter2|AKIA1234567890ABCDEF|provider-secret|private-material|inline-private-material|abcdefghijk|access-secret|refresh-secret|client-secret|cookie-secret|second-cookie-secret|set-cookie-secret/);
    expect(exported.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(11);
  });

  it("redacts before persistence and bounds incident fields and count", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-bounds-"));
    for (let index = 0; index < 260; index += 1) {
      recordAutopilotIncident(stateDir, {
        ...incidentInput(`${index}:${"x".repeat(2_100)} sk-abcdefghijk`),
        correlation_ids: Object.fromEntries(Array.from({ length: 40 }, (_, item) => [`id-${item}`, `value-${item}`])),
        event_refs: Array.from({ length: 40 }, (_, item) => `event-${item}`)
      });
    }

    const document = readIncidentStore(stateDir);
    expect(document.incidents).toHaveLength(256);
    expect(document.incidents[0]?.summary).toHaveLength(2_000);
    expect(document.incidents[0]?.event_refs).toHaveLength(32);
    expect(Object.keys(document.incidents[0]?.correlation_ids ?? {})).toHaveLength(32);
    expect(readFileSync(join(stateDir, "autopilot-incidents.json"), "utf8")).not.toContain("abcdefghijk");
  });

  it("bounds repair packet steps and serialized size", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "repair-bounds-"));
    const incident = recordAutopilotIncident(stateDir, incidentInput());
    const packet = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: "x".repeat(100_000),
      actual: "y".repeat(100_000),
      reproduction_steps: Array.from({ length: 30 }, () => "z".repeat(10_000)),
      verification_commands: Array.from({ length: 30 }, () => "v".repeat(10_000))
    });

    expect(packet.reproduction_steps).toHaveLength(20);
    expect(packet.verification_commands).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(packet), "utf8")).toBeLessThanOrEqual(64 * 1_024);

    const unicodePacket = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: "🧰".repeat(10_000),
      actual: "🔥".repeat(10_000),
      reproduction_steps: Array.from({ length: 20 }, () => "🧪".repeat(10_000)),
      verification_commands: Array.from({ length: 20 }, () => "✅".repeat(10_000))
    });
    expect(Buffer.byteLength(JSON.stringify(unicodePacket), "utf8")).toBeLessThanOrEqual(64 * 1_024);
  });

  it("rejects malformed, oversized, and unknown persisted state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-invalid-"));
    const path = join(stateDir, "autopilot-incidents.json");
    for (const invalid of [
      "{broken",
      JSON.stringify({ schema_version: "v1", incidents: [{ unexpected: true }] }),
      JSON.stringify({ schema_version: "v1", incidents: [], unexpected: true })
    ]) {
      writeFileSync(path, invalid, "utf8");
      expect(() => readIncidentStore(stateDir)).toThrow("invalid_incident_store");
    }
    writeFileSync(path, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20));
    expect(() => readIncidentStore(stateDir)).toThrow("invalid_incident_store");
  });

  it("rejects persisted fields that were not redacted before storage", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-unredacted-"));
    const incident = recordAutopilotIncident(stateDir, incidentInput("safe"));
    writeFileSync(join(stateDir, "autopilot-incidents.json"), JSON.stringify({
      schema_version: "v1",
      incidents: [{ ...incident, impact: "Authorization: Bearer loaded-secret" }]
    }));
    expect(() => readIncidentStore(stateDir)).toThrow("invalid_incident_store");
  });

  it("rejects every governed secret class when found in loaded state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-loaded-secrets-"));
    const path = join(stateDir, "autopilot-incidents.json");
    const incident = recordAutopilotIncident(stateDir, incidentInput("safe"));
    const secrets = [
      "passwd=loaded-password",
      "api-key: loaded-api-key",
      "access_token=loaded-access",
      "refresh_token=loaded-refresh",
      "client_secret=loaded-client",
      "Cookie: session=loaded-cookie",
      "Set-Cookie: auth=loaded-set-cookie",
      "AKIA1234567890ABCDEF",
      "-----BEGIN RSA PRIVATE KEY-----\nloaded-key\n-----END RSA PRIVATE KEY-----",
      "private-key=loaded-inline-private-key",
      "github_pat_loadedprovidertoken"
    ];
    for (const summary of secrets) {
      writeFileSync(path, JSON.stringify({ schema_version: "v1", incidents: [{ ...incident, summary }] }));
      expect(() => readIncidentStore(stateDir), summary).toThrow("invalid_incident_store");
    }
  });

  it("rejects unknown incidents without mutating state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-missing-"));
    expect(() => acknowledgeIncident(stateDir, "missing", "owner")).toThrow("incident_not_found");
    expect(() => prepareRepairPacket(stateDir, "missing", { expected: "x", actual: "y" })).toThrow("incident_not_found");
    expect(readIncidentStore(stateDir).incidents).toEqual([]);
  });
});
