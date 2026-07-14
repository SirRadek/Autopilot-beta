import { readFileSync } from "node:fs";
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
    expect(nft).toContain("tcp dport { 80, 443 } ip saddr != 192.168.122.1 drop");
    expect(nft).not.toMatch(/dport\s+22|policy\s+drop/i);
    expect(firewallUnit).toContain("ExecStartPre=-/usr/sbin/nft delete table inet autopilot_cockpit");
    expect(firewallUnit).toContain("ExecStop=-/usr/sbin/nft delete table inet autopilot_cockpit");
    expect(caddyDropIn).toContain("Requires=autopilot-cockpit-firewall.service");
  });
});
