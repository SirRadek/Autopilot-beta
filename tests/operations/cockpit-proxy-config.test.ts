import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const proxyDir = join(process.cwd(), "ops", "cockpit-proxy");

function readProxyFile(name: string): string {
  return readFileSync(join(proxyDir, name), "utf8");
}

describe("Cockpit production proxy boundary", () => {
  it("restricts TLS ingress to the host-only gateway and proxies only API routes", () => {
    const caddy = readProxyFile("Caddyfile");
    const nft = readProxyFile("autopilot-cockpit.nft");
    const firewallUnit = readProxyFile("autopilot-cockpit-firewall.service");
    const firewallHelper = readProxyFile("autopilot-cockpit-firewall.sh");
    const caddyDropIn = readProxyFile("caddy-autopilot.conf");

    expect(caddy).toContain("admin 127.0.0.1:2019");
    expect(caddy).toContain("bind 192.168.122.99");
    expect(caddy).toContain("tls internal");
    expect(caddy).toContain("reverse_proxy 127.0.0.1:8787");
    expect(caddy).toContain("root * /srv/autopilot-cockpit/current");
    expect(caddy).toContain("Strict-Transport-Security \"max-age=300\"");
    expect(caddy).not.toMatch(/0\.0\.0\.0|on_demand|cors|log\s*\{/i);
    for (const root of ["auth", "status", "sessions", "approvals", "workers", "providers", "projects", "runs", "incidents", "observability"]) {
      expect(caddy).toContain(`/${root} /${root}/*`);
    }
    expect(caddy).not.toContain("/auth*");
    expect(nft).toContain("table inet autopilot_cockpit");
    expect(nft).toContain("__AUTOPILOT_COCKPIT_NONCE__");
    expect(nft).toContain("tcp dport { 80, 443 } ip saddr != 192.168.122.1 drop");
    expect(nft).not.toMatch(/dport\s+22|policy\s+drop/i);
    expect(firewallUnit).not.toContain("delete table");
    expect(firewallUnit).toContain("ExecStart=/usr/local/libexec/autopilot-cockpit-firewall start");
    expect(firewallUnit).toContain("ExecStop=/usr/local/libexec/autopilot-cockpit-firewall stop");
    expect(firewallHelper).toContain("autopilot-cockpit:");
    expect(firewallHelper).toContain("nft -j list table inet");
    expect(firewallHelper).toContain("nft delete table inet");
    expect(caddyDropIn).toContain("Requires=autopilot-cockpit-firewall.service");
  });

  it("defines a bounded boot-persistent cutover recovery watchdog", () => {
    const service = readProxyFile("autopilot-cockpit-cutover-recovery.service");
    const timer = readProxyFile("autopilot-cockpit-cutover-recovery.timer");
    const launcher = readProxyFile("autopilot-cockpit-trusted-launcher.sh");
    const verifier = readProxyFile("autopilot-cockpit-recovery-verify.sh");

    expect(service).toContain("ExecStart=/usr/local/sbin/autopilot-cockpit-cutover --recover");
    expect(service).toContain("TimeoutStartSec=180");
    expect(timer).toContain("OnBootSec=30s");
    expect(timer).toContain("OnUnitActiveSec=30s");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("WantedBy=timers.target");
    expect(launcher).toContain("/usr/local/sbin/autopilot-cockpit-cutover");
    expect(launcher).toContain("setpriv");
    expect(launcher).toContain("env -i");
    expect(launcher).toMatch(/\/usr\/bin\/git[^\n]+ show /);
    expect(launcher).toContain("--install-watchdog");
    expect(verifier).toContain("provider_invoked");
    expect(verifier).toContain("systemd-run");
    expect(verifier).not.toMatch(/npm|git|checkout/i);
    expect(existsSync(join(proxyDir, "install-cutover-recovery-watchdog.sh"))).toBe(false);
  });

  it("does not expose a privileged cutover entry point from the mutable checkout", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const worker = readProxyFile("live-cutover.sh");

    expect(packageJson.scripts["ops:cockpit-proxy:cutover"]).toBeUndefined();
    expect(worker.startsWith("#!/bin/bash\n")).toBe(true);
    expect(worker).toContain('trusted_worker_path="/usr/local/libexec/autopilot-cockpit-live-cutover"');
    expect(worker.indexOf("trusted_worker_path=")).toBeLessThan(worker.indexOf("under_root()"));
  });

  it("publishes a bounded independent Task 6 bootstrap contract", () => {
    const contract = JSON.parse(readProxyFile("trusted-bootstrap-contract.json")) as {
      version: string;
      authority: string;
      canonical_checkout: string;
      canonical_origin: string;
      launcher: { path: string; uid: number; gid: number; mode: string };
      authorization: {
        path: string; uid: number; gid: number; mode: string; schema: string;
        digest: string; binds: string[]; authorization_id: string;
      };
      privileged_checkout_execution: boolean;
      prohibited: string[];
    };

    expect(contract).toEqual({
      version: "autopilot-cockpit-trusted-bootstrap-v1",
      authority: "independent-vm-image-root-channel",
      canonical_checkout: "/home/radek/autopilot-beta-proxy-candidate",
      canonical_origin: "https://github.com/SirRadek/Autopilot-beta.git",
      launcher: { path: "/usr/local/sbin/autopilot-cockpit-cutover", uid: 0, gid: 0, mode: "0755" },
      authorization: {
        path: "/etc/autopilot-cockpit/cutover.authorization",
        uid: 0,
        gid: 0,
        mode: "0400",
        schema: "autopilot-cockpit-authorization-v1",
        digest: "sha256",
        binds: ["sha", "checkout", "origin", "uid", "gid", "payload_count", "payload_hashes"],
        authorization_id: "sha256-of-all-preceding-record-lines-with-final-newline",
      },
      privileged_checkout_execution: false,
      prohibited: ["sudo-checkout-script", "sudo-npm", "sudo-bash-from-checkout"],
    });
    const launcher = readProxyFile("autopilot-cockpit-trusted-launcher.sh");
    expect(launcher).toContain('canonical_checkout="/home/radek/autopilot-beta-proxy-candidate"');
    expect(launcher).toContain('canonical_origin="https://github.com/SirRadek/Autopilot-beta.git"');
  });

  it("pins and verifies recovery smoke bundle provenance", () => {
    const script = join(process.cwd(), "scripts", "check-cockpit-recovery-smoke.mjs");
    const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const provenance = JSON.parse(readProxyFile("autopilot-cockpit-recovery-smoke.provenance.json"));
    expect(provenance).toEqual({
      version: "autopilot-cockpit-recovery-smoke-v1",
      source: "scripts/smoke-cockpit-run.ts",
      output: "ops/cockpit-proxy/autopilot-cockpit-recovery-smoke.mjs",
      source_sha256: "c63de72541f40d3d8fbaeae5362236f08f4b6d9570a423b1dbc51e4166185fcf",
      output_sha256: "f9595e0a654aa5eb622a507c99940fd51c74afa9125cd0d3a5c6c480f2e9b7d2",
      esbuild_version: "0.28.1",
      flags: ["--bundle", "--platform=node", "--format=esm", "--target=node24", "--minify"],
    });
  });
});
