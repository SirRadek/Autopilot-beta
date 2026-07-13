import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  acknowledgeIncident,
  prepareRepairPacket,
  readIncidentStore,
  recordAutopilotIncident
} from "../../src/data/delivery-system/incidentStore";
import {
  ingestOperationalIncidentSpool,
  recordOperationalIncident
} from "../../src/data/delivery-system/operationalIncidents";
import { acquireStateMaintenanceLock } from "../../src/data/delivery-system/stateMaintenanceLock";

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
  it("records only fixed operational stage, summary, and impact codes", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "operational-incident-"));

    const incident = recordOperationalIncident(stateDir, {
      stage: "control_plane_workers",
      correlation_ids: { request_id: "request-1" }
    });

    expect(incident).toMatchObject({
      stage: "control_plane_workers",
      summary: "operational_failure:control_plane_workers",
      impact: "operation_incomplete:control_plane_workers",
      correlation_ids: { request_id: "request-1" }
    });
  });

  it("does not lose concurrent incident read-modify-write updates", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-concurrent-"));
    const lease = acquireStateMaintenanceLock(stateDir);
    const childCode = [
      "import { recordAutopilotIncident } from './src/data/delivery-system/incidentStore.ts';",
      "const [stateDir, summary] = process.argv.slice(1);",
      "recordAutopilotIncident(stateDir, { severity: 'high', stage: 'concurrent', summary, correlation_ids: {}, impact: 'test', retry_count: 0, event_refs: [] });"
    ].join("\n");
    const children = ["first", "second"].map((summary) => spawn(process.execPath, [
      "--import", "tsx",
      "--input-type=module",
      "--eval", childCode,
      stateDir,
      summary
    ], { cwd: process.cwd(), stdio: "ignore" }));

    await new Promise((resolve) => setTimeout(resolve, 750));
    lease.release();
    await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child_exit:${code}`)));
    })));

    expect(readIncidentStore(stateDir).incidents.map((incident) => incident.summary).sort()).toEqual(["first", "second"]);
  }, 15_000);

  it("spools a fixed unique incident outside protected state when the lock times out", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "operational-incident-lock-"));
    const lockDir = join(stateDir, ".state-maintenance.lock");
    mkdirSync(lockDir, { mode: 0o700 });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({
      version: 1,
      token: "active-owner",
      pid: process.pid,
      hostname: hostname(),
      acquired_at: new Date().toISOString()
    })}\n`);

    const incident = recordOperationalIncident(stateDir, {
      stage: "state_maintenance",
      correlation_ids: {
        request_id: "request-locked",
        unexpected: "password=injected-secret"
      }
    });
    const spoolDir = join(dirname(stateDir), `.${basename(stateDir)}-incident-spool`);
    const spoolFiles = readdirSync(spoolDir);

    expect(readIncidentStore(stateDir).incidents).toEqual([]);
    expect(spoolFiles).toEqual([`${incident.incident_id}.json`]);
    expect(JSON.parse(readFileSync(join(spoolDir, spoolFiles[0]!), "utf8"))).toEqual(incident);
    expect(JSON.stringify(incident)).not.toContain("injected-secret");
    expect(incident.correlation_ids).toEqual({ request_id: "request-locked" });
    rmSync(lockDir, { recursive: true, force: true });

    expect(ingestOperationalIncidentSpool(stateDir)).toBe(1);
    expect(readIncidentStore(stateDir).incidents.map((item) => item.incident_id)).toEqual([incident.incident_id]);
    expect(readdirSync(spoolDir)).toEqual([]);
    rmSync(spoolDir, { recursive: true, force: true });
  }, 10_000);
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

  it("redacts quoted structured secrets, quoted cookies, and unterminated PEM from persistence and export", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-adversarial-secrets-"));
    const incident = recordAutopilotIncident(stateDir, {
      ...incidentInput('{"password":"json-password-secret"}'),
      impact: "-----BEGIN CERTIFICATE-----\nunterminated-pem-secret",
      event_refs: ["Cookie: \"session=quoted-cookie-secret\"", "Set-Cookie: 'auth=quoted-set-cookie-secret'"]
    });
    const packet = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: '{"client_secret":"json-client-secret"}',
      actual: "-----BEGIN OPENSSH PRIVATE KEY-----\ntruncated-private-secret",
      reproduction_steps: ["{\"api_key\":\"json-api-secret\"}", '{"aws_secret_access_key":"json-aws-secret"}'],
      verification_commands: ["Cookie: \"repair-cookie-secret\""]
    });
    const persisted = readFileSync(join(stateDir, "autopilot-incidents.json"), "utf8");
    const exported = JSON.stringify(packet);

    expect(`${persisted}${exported}`).not.toMatch(/json-password-secret|unterminated-pem-secret|quoted-cookie-secret|quoted-set-cookie-secret|json-client-secret|truncated-private-secret|json-api-secret|json-aws-secret|repair-cookie-secret/);
  });

  it("redacts JSON authorization and escaped JSON secret strings without leaking suffixes", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-escaped-json-"));
    const incident = recordAutopilotIncident(stateDir, incidentInput('{"authorization":"Bearer input-auth-secret\\\" input-suffix-secret"}'));
    const packet = prepareRepairPacket(stateDir, incident.incident_id, {
      expected: '{"password":"expected-secret\\\" expected-suffix-secret"}',
      actual: '{"authorization":"Bearer actual-secret\\\\path actual-suffix-secret"}',
      reproduction_steps: ['{"client_secret":"repro-secret\\\" repro-suffix-secret"}'],
      verification_commands: ['{"access_token":"command-secret\\\\path command-suffix-secret"}']
    });
    const output = JSON.stringify(packet);

    expect(output).not.toMatch(/input-auth-secret|input-suffix-secret|expected-secret|expected-suffix-secret|actual-secret|actual-suffix-secret|repro-secret|repro-suffix-secret|command-secret|command-suffix-secret/);
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
  }, 15_000);

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

  it("rejects unsafe loaded identity, timestamp, structured secrets, and truncated PEM", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-loaded-adversarial-"));
    const path = join(stateDir, "autopilot-incidents.json");
    const incident = recordAutopilotIncident(stateDir, incidentInput("safe"));
    const mutations = [
      { ...incident, incident_id: "password=identity-secret" },
      { ...incident, incident_id: "not-a-safe-generated-id" },
      { ...incident, recorded_at: "access_token=timestamp-secret" },
      { ...incident, recorded_at: "yesterday" },
      { ...incident, summary: '{"password":"loaded-json-secret"}' },
      { ...incident, summary: '{"authorization":"Bearer loaded-auth-secret\\\" loaded-auth-suffix"}' },
      { ...incident, impact: "Cookie: \"loaded-quoted-cookie-secret\"" },
      { ...incident, event_refs: ["-----BEGIN CERTIFICATE-----\nloaded-truncated-pem"] }
    ];
    for (const candidate of mutations) {
      writeFileSync(path, JSON.stringify({ schema_version: "v1", incidents: [candidate] }));
      expect(() => readIncidentStore(stateDir)).toThrow("invalid_incident_store");
    }
  });

  it("rejects a password-shaped acknowledgement timestamp before repair export", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-loaded-ack-time-"));
    const path = join(stateDir, "autopilot-incidents.json");
    const incident = acknowledgeIncident(stateDir, recordAutopilotIncident(stateDir, incidentInput("safe")).incident_id, "owner");
    writeFileSync(path, JSON.stringify({
      schema_version: "v1",
      incidents: [{ ...incident, acknowledged_at: "password=loaded-ack-secret" }]
    }));

    expect(() => prepareRepairPacket(stateDir, incident.incident_id, { expected: "safe", actual: "safe" })).toThrow("invalid_incident_store");
  });

  it("rejects unknown incidents without mutating state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "incident-missing-"));
    expect(() => acknowledgeIncident(stateDir, "missing", "owner")).toThrow("incident_not_found");
    expect(() => prepareRepairPacket(stateDir, "missing", { expected: "x", actual: "y" })).toThrow("incident_not_found");
    expect(readIncidentStore(stateDir).incidents).toEqual([]);
  });
});
