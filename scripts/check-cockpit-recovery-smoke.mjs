#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRelative = "scripts/smoke-cockpit-run.ts";
const outputRelative = "ops/cockpit-proxy/autopilot-cockpit-recovery-smoke.mjs";
const provenanceRelative = "ops/cockpit-proxy/autopilot-cockpit-recovery-smoke.provenance.json";
const source = join(root, sourceRelative);
const output = join(root, outputRelative);
const provenancePath = join(root, provenanceRelative);
const esbuild = join(root, "node_modules", ".bin", "esbuild");
const flags = ["--bundle", "--platform=node", "--format=esm", "--target=node24", "--minify"];
const mode = process.argv[2];

if (mode !== "--check" && mode !== "--write") process.exit(64);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const versionResult = spawnSync(esbuild, ["--version"], { encoding: "utf8", cwd: root });
if (versionResult.status !== 0) throw new Error("recovery_smoke_esbuild_unavailable");
const esbuildVersion = versionResult.stdout.trim();
const work = mkdtempSync(join(tmpdir(), "autopilot-recovery-smoke-"));
const generated = join(work, "recovery-smoke.mjs");

try {
  const built = spawnSync(esbuild, [source, ...flags, `--outfile=${generated}`], { cwd: root, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`recovery_smoke_build_failed:${built.stderr.trim()}`);
  const sourceBytes = readFileSync(source);
  const outputBytes = readFileSync(generated);
  const provenance = {
    version: "autopilot-cockpit-recovery-smoke-v1",
    source: sourceRelative,
    output: outputRelative,
    source_sha256: sha256(sourceBytes),
    output_sha256: sha256(outputBytes),
    esbuild_version: esbuildVersion,
    flags,
  };
  if (mode === "--write") {
    renameSync(generated, output);
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });
  } else {
    if (!readFileSync(output).equals(outputBytes)) throw new Error("recovery_smoke_bundle_drift");
    const recorded = JSON.parse(readFileSync(provenancePath, "utf8"));
    if (JSON.stringify(recorded) !== JSON.stringify(provenance)) throw new Error("recovery_smoke_provenance_drift");
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
