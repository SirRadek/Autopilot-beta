# Production Cockpit TLS Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Autopilot Cockpit at trusted `https://autopilot.local` for the Victus host only, while keeping the Control Plane loopback-only and preserving deterministic rollback.

**Architecture:** Caddy binds to VM address `192.168.122.99`, serves an immutable Cockpit release from `/srv/autopilot-cockpit`, and proxies only explicit Control Plane routes to `127.0.0.1:8787`. A dedicated nftables systemd unit drops `80/443` traffic not sourced from `192.168.122.1`; isolated acceptance uses `8443/8877` and separate state before transactional cutover.

**Tech Stack:** Ubuntu 24.04, Node.js 24, TypeScript, Vitest, Playwright, Caddy, systemd, nftables, Bash, curl, OpenSSL

## Global Constraints

- Public origin is exactly `https://autopilot.local`; Victus maps it to `192.168.122.99`.
- Ports `80/443` accept only IPv4 source `192.168.122.1`; SSH and global firewall policy do not change.
- Control Plane remains on `127.0.0.1:8787`; isolated Control Plane uses `127.0.0.1:8877` only.
- Production Caddy binds only to `192.168.122.99`; isolated Caddy uses `192.168.122.99:8443`.
- Caddy uses `tls internal`; only its public CA root may leave the VM.
- Production uses `CONTROL_PLANE_SECURE_COOKIES=true`; rollback restores exact prior environment bytes.
- Releases are root-owned, read-only, addressed by exact Git SHA, and covered by a sorted SHA-256 manifest outside the document root.
- No wildcard CORS, public admin endpoint, TLS bypass, `curl -k`, provider configuration, provider invocation, or paid call.
- Reboot acceptance requires separate explicit owner confirmation after live cutover.
- Source design: `docs/superpowers/specs/2026-07-14-production-cockpit-tls-proxy-design.md`.

## File Map

- `ops/cockpit-proxy/Caddyfile`: TLS, headers, caching, SPA fallback, and API proxy routes.
- `ops/cockpit-proxy/autopilot-cockpit.nft`: host-only nftables table.
- `ops/cockpit-proxy/autopilot-cockpit-firewall.service`: idempotent table ownership.
- `ops/cockpit-proxy/caddy-autopilot.conf`: Caddy dependency on firewall setup.
- `ops/cockpit-proxy/stage-release.sh`: immutable release installation without activation.
- `ops/cockpit-proxy/isolated-acceptance.sh`: isolated `8443/8877` lifecycle and cleanup.
- `ops/cockpit-proxy/host-acceptance.sh`: trusted TLS/application acceptance from Victus.
- `ops/cockpit-proxy/live-cutover.sh`: transactional live switch and rollback.
- `tests/operations/cockpit-proxy-config.test.ts`: configuration invariants.
- `tests/operations/cockpit-proxy-scripts.test.ts`: temp-root, failure-injection, cleanup, and rollback tests.
- `playwright.proxy.config.ts`, `tests/browser-proxy/cockpit-proxy.spec.ts`: real trusted-origin browser tests.
- Operations docs, project status/work log, and project Decision Mesh: procedure and evidence.

---

### Task 1: Lock the production proxy boundary

**Files:**
- Create: `ops/cockpit-proxy/Caddyfile`
- Create: `ops/cockpit-proxy/autopilot-cockpit.nft`
- Create: `ops/cockpit-proxy/autopilot-cockpit-firewall.service`
- Create: `ops/cockpit-proxy/caddy-autopilot.conf`
- Create: `tests/operations/cockpit-proxy-config.test.ts`

**Interfaces:**
- Consumes: `autopilot.local`, `192.168.122.99`, `192.168.122.1`, and `127.0.0.1:8787`.
- Produces: four installable root-owned artifacts with no runtime templating.

- [ ] **Step 1: Write failing configuration tests**

Read all four files and assert:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/operations/cockpit-proxy-config.test.ts`

Expected: FAIL because the proxy artifacts do not exist.

- [ ] **Step 3: Add minimal production configuration**

Use this exact Caddy structure:

```caddyfile
{
	admin 127.0.0.1:2019
}
autopilot.local {
	bind 192.168.122.99
	tls internal
	root * /srv/autopilot-cockpit/current
	header {
		Content-Security-Policy "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Strict-Transport-Security "max-age=300"
	}
	@api path /auth /auth/* /status /status/* /sessions /sessions/* /approvals /approvals/* /workers /workers/* /providers /providers/* /projects /projects/* /runs /runs/* /incidents /incidents/* /observability /observability/*
	handle @api {
		header Cache-Control "no-store"
		reverse_proxy 127.0.0.1:8787
	}
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@document not path /assets/*
	header @document Cache-Control "no-cache"
	@spa {
		method GET HEAD
		not file
	}
	rewrite @spa /index.html
	file_server
}
```

The nftables file defines `table inet autopilot_cockpit`, input hook priority `-10`, policy accept, and only the source-restriction drop. The oneshot unit deletes its named table before load and on stop. The Caddy drop-in contains only `Requires=` and `After=` for the firewall unit.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/operations/cockpit-proxy-config.test.ts
git diff --check
git add ops/cockpit-proxy tests/operations/cockpit-proxy-config.test.ts
git commit -m "feat: define host-only cockpit proxy boundary"
```

Expected: focused tests and whitespace checks pass.

---

### Task 2: Stage immutable Cockpit releases

**Files:**
- Create: `ops/cockpit-proxy/stage-release.sh`
- Create: `tests/operations/cockpit-proxy-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `stage-release.sh CHECKOUT RELEASE_ROOT`, clean Git checkout, Node 24, existing `cockpit/dist`.
- Produces: `releases/$SHA`, `manifests/$SHA.sha256`, JSON success; never changes `current`.

- [ ] **Step 1: Write temporary-root tests**

Create a temporary Git repo with `cockpit/dist/index.html` and `assets/app.js`. Assert:

```ts
expect(result.status).toBe(0);
expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sha });
expect(readFileSync(join(root, "releases", sha, "index.html"), "utf8")).toBe("cockpit\n");
expect(readFileSync(join(root, "manifests", `${sha}.sha256`), "utf8")).toMatch(/assets\/app\.js/);
expect(existsSync(join(root, "current"))).toBe(false);
expect(statSync(join(root, "releases", sha, "index.html")).mode & 0o222).toBe(0);
```

Add rejection cases for dirty checkout, non-Node-24 runtime, symlink in `dist`, symlink release root, and existing release with a different manifest.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/operations/cockpit-proxy-scripts.test.ts`

Expected: FAIL because `stage-release.sh` does not exist.

- [ ] **Step 3: Implement staging**

The script uses `set -Eeuo pipefail`, exactly two arguments, `realpath`, and this ordering:

```bash
sha="$(git -C "$checkout" rev-parse HEAD)"
test -z "$(git -C "$checkout" status --porcelain)"
node_bin="${AUTOPILOT_NODE_BIN:-/usr/bin/node}"
case "$("$node_bin" --version)" in v24.*) ;; *) exit 1 ;; esac
test -f "$checkout/cockpit/dist/index.html"
test -z "$(find "$checkout/cockpit/dist" -type l -print -quit)"
install -d -m 0755 "$release_root/releases" "$release_root/manifests"
candidate="$(mktemp -d "$release_root/releases/.candidate-${sha}.XXXXXX")"
cp -R --no-preserve=ownership,mode,timestamps "$checkout/cockpit/dist/." "$candidate/"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +
(cd "$candidate" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$release_root/manifests/$sha.sha256.tmp"
```

Verify the temporary manifest, atomically rename candidate and manifest, treat identical release as idempotent, reject a different existing release, and emit JSON via Node `JSON.stringify`. Add package script `ops:cockpit-proxy:stage`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/operations/cockpit-proxy-scripts.test.ts
npm run typecheck
git diff --check
git add ops/cockpit-proxy/stage-release.sh tests/operations/cockpit-proxy-scripts.test.ts package.json
git commit -m "feat: stage immutable cockpit releases"
```

Expected: all tests pass and `current` remains untouched.

---

### Task 3: Add isolated acceptance and trusted host tests

**Files:**
- Create: `ops/cockpit-proxy/isolated-acceptance.sh`
- Create: `ops/cockpit-proxy/host-acceptance.sh`
- Create: `playwright.proxy.config.ts`
- Create: `tests/browser-proxy/cockpit-proxy.spec.ts`
- Modify: `tests/operations/cockpit-proxy-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: exact candidate, staged release, isolated state, trusted CA, `AUTOPILOT_PROXY_BASE_URL`.
- Produces: `ISOLATED_ACCEPTANCE_READY`, public root fingerprint, `HOST_PROXY_ACCEPTANCE_OK`, then no isolated listener/table.

- [ ] **Step 1: Write lifecycle and browser tests**

Stub `systemd-run`, `systemctl`, `nft`, `ss`, `caddy`, and `curl` through a test PATH. Assert firewall creation precedes proxy start; cleanup always stops both transient units and deletes only `inet autopilot_cockpit_isolated`; pre-existing ports/table refuse mutation; output never contains the isolated token.

The Playwright test contains:

```ts
await page.goto("/");
await page.getByLabel("Control Plane token").fill(process.env.AUTOPILOT_PROXY_TEST_TOKEN!);
await page.getByRole("button", { name: "Přihlásit" }).click();
await expect(page.getByRole("heading", { name: "Hybrid Cockpit" })).toBeVisible();
expect(await page.evaluate(() => performance.getEntriesByType("resource").every((entry) => new URL(entry.name).origin === location.origin))).toBe(true);
```

The proxy Playwright config requires HTTPS, uses `ignoreHTTPSErrors: false`, disables trace/video/screenshots, and starts no web server.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t isolated`

Expected: FAIL because acceptance scripts are absent.

- [ ] **Step 3: Implement isolated lifecycle**

Register failure cleanup before the first mutation:

```bash
cleanup() {
  set +e
  systemctl stop autopilot-cockpit-isolated-proxy.service
  systemctl stop autopilot-cockpit-isolated-control-plane.service
  nft delete table inet autopilot_cockpit_isolated
  rm -rf "$isolated_runtime"
}
trap cleanup EXIT INT TERM
```

Require free `8443/8877`, no existing named table, valid release manifest, and `caddy validate`. Create isolated state/projects mode `0700`, environment mode `0600`, fixed test token, and secure cookies. Start Control Plane at `8877`; render Caddy with site port `8443` and upstream `8877`; restrict `8443` to `192.168.122.1`; start as `caddy`; wait with bounded retries. On success, disable the EXIT trap before printing only public CA path/fingerprint and `ISOLATED_ACCEPTANCE_READY`, leaving the transient services available for the host test. Support idempotent `--cleanup`, and call it explicitly after host acceptance; failures and signals still run cleanup automatically.

The host script requires approved URLs, normal certificate verification, SAN `autopilot.local`, headers/cache policies, exact API/lookalike routing, secure cookie flags, accepted same-origin mutation, rejected evil origin, and logout. It captures a token from `AUTOPILOT_PROXY_TOKEN_COMMAND` without printing it, uses a `0600` cookie jar, unsets the token, never enables shell tracing, and contains no insecure TLS flag. Isolated acceptance supplies a fixed-token command; production supplies an SSH command that reads the protected VM environment without echoing it to the terminal. Add package scripts `ops:cockpit-proxy:isolated`, `ops:cockpit-proxy:host-acceptance`, and `browser:qa:proxy`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/operations/cockpit-proxy-scripts.test.ts
AUTOPILOT_PROXY_BASE_URL=https://autopilot.local:8443 AUTOPILOT_PROXY_TEST_TOKEN=isolated-test-token npx playwright test --config playwright.proxy.config.ts --list
git diff --check
git add ops/cockpit-proxy playwright.proxy.config.ts tests/browser-proxy tests/operations/cockpit-proxy-scripts.test.ts package.json
git commit -m "test: add isolated cockpit proxy acceptance"
```

Expected: lifecycle, cleanup, secret-output, and test-list checks pass without network mutation.

---

### Task 4: Add transactional live cutover and rollback

**Files:**
- Create: `ops/cockpit-proxy/live-cutover.sh`
- Modify: `tests/operations/cockpit-proxy-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: accepted SHA, protected environment, staged release, reviewed configs, fresh recovery evidence.
- Produces: `CUTOVER_OK` or `ROLLBACK_OK`; canonical state is never auto-restored.

- [ ] **Step 1: Write fake-root failure-injection tests**

Use a temporary root and stub privileged commands. Cover success and forced failure after every mutation. Require firewall before Caddy, exact restoration of environment bytes and prior `current`, removal of only owned nftables table, loopback health/readiness/smoke after rollback, and refusal for unowned existing Caddy, dirty checkout, invalid manifest, occupied acceptance ports, or missing isolated evidence. Test both a valid host-acceptance acknowledgement and a bounded acknowledgement timeout that rolls back automatically.

```ts
expect(success.stdout).toContain("CUTOVER_OK");
expect(events.indexOf("systemctl:start:autopilot-cockpit-firewall.service"))
  .toBeLessThan(events.indexOf("systemctl:start:caddy.service"));
expect(failure.stdout).toContain("ROLLBACK_OK");
expect(readFileSync(envPath)).toEqual(previousEnvironmentBytes);
expect(readlinkSync(currentPath)).toBe(previousReleaseTarget);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/operations/cockpit-proxy-scripts.test.ts -t cutover`

Expected: FAIL because `live-cutover.sh` is absent.

- [ ] **Step 3: Implement transactional cutover**

Use `set -Eeuo pipefail`, a mode-`0600` ledger, named mutation/rollback functions, and:

```bash
trap 'status=$?; if (( status != 0 && cutover_started == 1 && rollback_started == 0 )); then rollback; fi; exit "$status"' EXIT INT TERM
```

Preflight verifies SHA/manifest, live health, ownership, free `8443/8877`, stable paths, and isolated evidence. It requires the Caddy package to be installed, `caddy.service` masked/inactive, no Caddy listener, and `dpkg -V caddy` to prove the still-unmodified package-owned default files; any changed or unowned existing configuration is refused. Back up environment/config/link bytes, run fresh state backup and recovery validation, install/start firewall, atomically switch `current`, change exactly one secure-cookie assignment, restart Control Plane, install reviewed Caddy files/drop-in, remove mask, and start Caddy.

After VM-local verification, print `CUTOVER_WAITING_FOR_HOST_ACCEPTANCE` with a random acknowledgement ID and wait at most 300 seconds for a root-owned acknowledgement file in a newly created mode-`0700` runtime directory. A second invocation `live-cutover.sh --accept ACK_ID` validates the ID and atomically writes that file only after the Victus host test succeeds. Missing or invalid acknowledgement triggers rollback; valid acknowledgement completes with `CUTOVER_OK`. Rollback stops owned Caddy/firewall, restores link/config/environment, restarts loopback Control Plane, and verifies boundary/readiness plus deterministic smoke with `provider_invoked=false`. Add package script `ops:cockpit-proxy:cutover`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/operations/cockpit-proxy-config.test.ts tests/operations/cockpit-proxy-scripts.test.ts
npm run verify
git diff --check
git add ops/cockpit-proxy/live-cutover.sh tests/operations/cockpit-proxy-scripts.test.ts package.json
git commit -m "feat: add transactional cockpit proxy cutover"
```

Expected: all success/refusal/rollback cases pass; only existing baseline warnings remain.

---

### Task 5: Document operations and Decision Mesh impact

**Files:**
- Modify: `docs/operations/configuration.md`
- Modify: `docs/operations/install-ubuntu-vm.md`
- Modify: `docs/operations/service-runbook.md`
- Modify: `docs/operations/troubleshooting.md`
- Modify: `ops/systemd/README.md`
- Modify: `docs/projects/autopilot-control-plane/decision-mesh/nodes/control_plane_boundary.yaml`
- Modify: `docs/projects/autopilot-control-plane/decision-mesh/edges.yaml`
- Modify: `docs/projects/autopilot-control-plane/work-log.md`
- Modify: `scripts/check-documentation-links.ts`
- Modify: `tests/operations/cockpit-proxy-config.test.ts`

**Interfaces:**
- Consumes: exact service names, markers, commands, and rollback from Tasks 1–4.
- Produces: canonical procedure and mesh stop conditions for public/LAN ingress, TLS bypass, and non-loopback Control Plane.

- [ ] **Step 1: Add failing documentation tests**

```ts
expect(configuration).toContain("https://autopilot.local");
expect(configuration).toContain("192.168.122.1");
expect(installGuide).toContain("autopilot-cockpit-firewall.service");
expect(runbook).toContain("HOST_PROXY_ACCEPTANCE_OK");
expect(runbook).toContain("ROLLBACK_OK");
expect(troubleshooting).not.toContain("curl -k");
expect(controlPlaneNode).toContain("host_only_tls_ingress");
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/operations/cockpit-proxy-config.test.ts`

Expected: FAIL on missing canonical procedure.

- [ ] **Step 3: Write docs and mesh rules**

Document exact host/VM commands, CA fingerprint/trust install/removal, mask-before-package rule, release layout, isolated acceptance, cutover, rollback, listeners, and no-bypass policy. Add spec, plan, and canonical proxy docs to link validation. Extend the boundary with:

```yaml
signals:
  - host_only_tls_ingress
required_checks:
  - cockpit_proxy_source_restriction
  - loopback_control_plane_listener
  - trusted_local_ca
  - deterministic_proxy_rollback
stop_conditions:
  - public_or_lan_ingress_added
  - certificate_verification_bypassed
  - control_plane_rebound_from_loopback
```

Add only edges to existing auth, observability, and recovery boundaries.

- [ ] **Step 4: Regenerate, verify, and commit**

```bash
npm run mesh:generate
npm run mesh:snapshot:regen
npm test -- tests/operations/cockpit-proxy-config.test.ts tests/decision-mesh/generated.test.ts
npm run docs:links
npm run mesh:gate:ci
git diff --check
git add docs/operations ops/systemd/README.md docs/projects/autopilot-control-plane scripts/check-documentation-links.ts mesh/generated/decision-mesh.json mesh/related-files-snapshot.json tests/operations/cockpit-proxy-config.test.ts
git commit -m "docs: add cockpit proxy operating contract"
```

Expected: no dead pointer or documentation-link failure.

---

### Task 6: Verify, publish, and run isolated VM acceptance

**Files:**
- Runtime candidate: `/home/radek/autopilot-beta-proxy-candidate`
- Runtime isolated state: `/tmp/autopilot-cockpit-proxy-state`
- Runtime public CA export: `/tmp/autopilot-caddy-root.crt`
- Do not modify live checkout `/home/radek/autopilot-beta`.

**Interfaces:**
- Consumes: clean branch and persistent VM SSH key.
- Produces: green draft PR, exact SHA, stable-IP evidence, `ISOLATED_ACCEPTANCE_READY`, matching CA fingerprints, and `HOST_PROXY_ACCEPTANCE_OK` on `8443`; live config unchanged.

- [ ] **Step 1: Run complete local verification**

```bash
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:/usr/bin:/bin npm run verify
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:/usr/bin:/bin npm run cockpit:test
PATH=/home/radek/.local/node-v24.18.0-linux-x64/bin:/usr/bin:/bin npm run cockpit:build
git diff --check
git status --short
```

Expected: all pass and worktree clean.

- [ ] **Step 2: Push and open a draft PR**

```bash
git push -u origin agent/design-production-cockpit-proxy
gh pr create --draft --base main --head agent/design-production-cockpit-proxy --title "feat: add host-only production cockpit proxy" --body-file /tmp/autopilot-cockpit-proxy-pr.md
gh pr checks --watch
```

Expected: required CI green and local/remote/PR SHA identical.

- [ ] **Step 3: Verify VM/network read-only**

```bash
virsh domifaddr autopilot-phase0
virsh net-dumpxml default
ssh -i ~/.ssh/autopilot-vm_ed25519 radek@192.168.122.99 'ip -4 route; ss -ltn; systemctl is-active autopilot-control-plane.service; systemctl is-active autopilot-control-plane-health.timer autopilot-state-maintenance.timer'
```

Expected: stable `192.168.122.99`, host gateway/source `192.168.122.1`, loopback `8787`, active services. Stop for owner network decision if IP is not persistent.

- [ ] **Step 4: Transfer exact candidate and install Caddy safely**

Create/fetch candidate at exact PR SHA; require clean status; run `/usr/bin/npm ci`, `verify`, `cockpit:test`, `cockpit:build`. Prove `80/443/8443/8877` free, mask `caddy.service`, install only from official stable Caddy Ubuntu repository, and prove Caddy inactive with no listener. Keep the mask.

- [ ] **Step 5: Stage and run isolated acceptance**

```bash
sudo bash /home/radek/autopilot-beta-proxy-candidate/ops/cockpit-proxy/stage-release.sh /home/radek/autopilot-beta-proxy-candidate /srv/autopilot-cockpit
sudo bash /home/radek/autopilot-beta-proxy-candidate/ops/cockpit-proxy/isolated-acceptance.sh /home/radek/autopilot-beta-proxy-candidate /srv/autopilot-cockpit /tmp/autopilot-cockpit-proxy-state
```

On Victus, add exact hosts mapping, copy only public root, compare fingerprint, install it as `/usr/local/share/ca-certificates/autopilot-caddy-root.crt`, update trust, and run host acceptance against `https://autopilot.local:8443` with `AUTOPILOT_PROXY_TOKEN_COMMAND='printf %s isolated-test-token'`. Expected: trusted TLS without bypass, Playwright green, `HOST_PROXY_ACCEPTANCE_OK`. Then invoke `isolated-acceptance.sh --cleanup` and prove no `8443/8877` or isolated table.

---

### Task 7: Owner-gated cutover, reboot, and closeout

**Files:**
- Runtime environment: `/home/radek/.config/autopilot/control-plane.env`
- Runtime proxy paths under `/etc/caddy`, `/etc/nftables.d`, `/etc/systemd/system`, `/srv/autopilot-cockpit`
- Modify after acceptance: `docs/status/current-status.md`
- Modify after acceptance: `docs/projects/autopilot-control-plane/work-log.md`
- Modify if evidence changes it: project Decision Mesh

**Interfaces:**
- Consumes: green isolated evidence, accepted SHA, fresh recovery evidence, explicit cutover approval, then separate reboot approval.
- Produces: `CUTOVER_OK` or `ROLLBACK_OK`, post-reboot evidence, closeout commit, green PR, retained rollback artifacts.

- [ ] **Step 1: Present cutover packet and wait**

Report SHA, PR/CI, CA fingerprint, isolated results, stable IP, live SHA, recovery point, exact mutations, and rollback. Do not mutate live proxy/environment without approval.

- [ ] **Step 2: Capture recovery evidence and cut over**

Create/validate fresh backup and recovery drill; record hashes, services/timers, boundary, liveness/readiness, and deterministic smoke. Run:

```bash
sudo bash /home/radek/autopilot-beta-proxy-candidate/ops/cockpit-proxy/live-cutover.sh /home/radek/autopilot-beta-proxy-candidate /srv/autopilot-cockpit "$CANDIDATE_SHA"
```

Expected: the first terminal reports `CUTOVER_WAITING_FOR_HOST_ACCEPTANCE` and an acknowledgement ID while keeping the rollback trap active. It must not print a secret.

- [ ] **Step 3: Verify production and request reboot approval**

In a second Victus terminal, run host acceptance with an SSH token command that captures the VM token without displaying it:

```bash
AUTOPILOT_PROXY_BASE_URL=https://autopilot.local \
AUTOPILOT_PROXY_TOKEN_COMMAND="ssh -i $HOME/.ssh/autopilot-vm_ed25519 radek@192.168.122.99 sed -n 's/^CONTROL_PLANE_TOKEN=//p' /home/radek/.config/autopilot/control-plane.env" \
bash ops/cockpit-proxy/host-acceptance.sh
```

The host script captures command stdout directly into a private shell variable, rejects zero or multiple token lines, and never forwards the token to terminal output or Playwright artifacts. If and only if that command returns `HOST_PROXY_ACCEPTANCE_OK`, acknowledge the waiting cutover with:

```bash
ssh -t -i ~/.ssh/autopilot-vm_ed25519 radek@192.168.122.99 "sudo /home/radek/autopilot-beta-proxy-candidate/ops/cockpit-proxy/live-cutover.sh --accept $ACK_ID"
```

The first terminal must then finish with `CUTOVER_OK`. If host acceptance fails, do not acknowledge; the 300-second timeout must produce `ROLLBACK_OK`.

After success, independently verify TLS, redirect, headers, browser, source policy, listeners, Control Plane/timers, Caddy/firewall, boundary, backup/recovery, readiness, and deterministic smoke with `provider_invoked=false`. Require loopback-only `8787`, `80/443` only on VM IP, no `8443/8877`, core ready, providers explicitly unconfigured. Retain rollback artifacts and ask separately for reboot approval.

- [ ] **Step 4: Reboot and repeat acceptance**

After approval, record boot ID, reboot via `virsh`, wait with bounded SSH retries, require new boot ID, stable IP, automatic services/firewall/listeners, trusted browser flow, secure cookie, boundary, readiness, backup/recovery, no-provider smoke.

- [ ] **Step 5: Record, verify, publish, and merge after review**

Update status/work log with SHA, boot IDs, public CA fingerprint, release, restart counts, listener/firewall facts, recovery paths, bounded smoke IDs. Run:

```bash
npm run mesh:generate
npm run mesh:snapshot:regen
npm run verify
npm run cockpit:test
npm run cockpit:build
git diff --check
git add docs/status/current-status.md docs/projects/autopilot-control-plane mesh/generated/decision-mesh.json mesh/related-files-snapshot.json
git commit -m "docs: record production cockpit proxy acceptance"
git push
gh pr ready
gh pr checks --watch
```

Expected: CI green. Merge only after owner review; preserve worktree, proxy rollback bundle, prior release, Autopilot rollback checkout, and state backups.
