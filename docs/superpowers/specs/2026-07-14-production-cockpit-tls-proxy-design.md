# Production Cockpit TLS Proxy Design

Date: 2026-07-14
Status: owner-approved design
Scope: single-operator Cockpit access from the Victus host to the Ubuntu VM

## Purpose

Add the first production-shaped Cockpit ingress without changing the Autopilot execution or provider
boundary. The browser on the Victus host will use `https://autopilot.local`; the Control Plane will
remain bound to `127.0.0.1:8787` inside the VM. No LAN or public-internet exposure is in scope.

The design closes the current production-proxy acceptance milestone while preserving the deployed
root-systemd service, secure browser-cookie contract, deterministic no-provider acceptance, and
rollback evidence.

## Decisions

- Access is restricted to the Victus host, whose libvirt-side source address is `192.168.122.1`.
- The VM address is `192.168.122.99`; cutover requires evidence that this address is stable across
  reboot. If no persistent libvirt reservation or equivalent stable assignment exists, cutover stops
  for a separately reviewed host-network decision.
- The public operator origin is exactly `https://autopilot.local`.
- The Victus `/etc/hosts` file maps `autopilot.local` to `192.168.122.99`.
- Caddy runs in the VM, terminates TLS with its internal CA, serves the static Cockpit, and proxies the
  explicit Control Plane route set.
- The Caddy public root certificate is trusted on Victus. CA private keys stay in the Caddy data
  directory in the VM and are never copied to the host, repository, Autopilot state, or backups.
- A dedicated nftables service drops traffic to VM ports `80` and `443` unless the IPv4 source is
  `192.168.122.1`. It does not change SSH policy.
- Provider configuration and execution are out of scope. All acceptance is deterministic and uses no
  provider.

## Non-goals

- LAN, VPN, or public-internet ingress
- multi-user identity, SSO, OAuth, or persistent browser sessions
- exposing the Control Plane listener directly
- wildcard CORS or additional public API contracts
- changing SSH access or the VM's general firewall policy
- enabling Codex, Claude, AGY, OpenRouter, or paid model calls
- automating host trust or libvirt mutations without an explicit operator step

## Architecture

```text
Victus browser
  -> /etc/hosts: autopilot.local = 192.168.122.99
  -> https://autopilot.local
  -> VM nftables source restriction: allow only 192.168.122.1 to 80/443
  -> Caddy bound to 192.168.122.99:80/443
       -> static Cockpit release under /srv/autopilot-cockpit/current
       -> explicit protected routes to http://127.0.0.1:8787
  -> loopback-only root-systemd Control Plane
```

Caddy's administration listener remains loopback-only. Access logging is not enabled; service and
configuration errors go to journald without request cookies, authorization values, or response bodies.

## Components and ownership

### Cockpit release store

Production assets live outside `/home` so the packaged Caddy service can read them without weakening
directory permissions:

```text
/srv/autopilot-cockpit/
  releases/<git-sha>/
  manifests/<git-sha>.sha256
  current -> releases/<git-sha>
```

Each release is built from one exact clean Git commit with Node 24. The deployment records the commit,
generates and verifies a sorted SHA-256 manifest outside the served document root, installs root-owned
read-only files, and atomically replaces the root-owned `current` symlink. A failed candidate is
retained under its exact SHA for diagnosis; it is never mistaken for the active release.

### Caddy

The official stable Caddy package and systemd service are used. The configuration:

- binds only to `192.168.122.99`;
- uses `tls internal` for `autopilot.local`;
- redirects HTTP to HTTPS;
- serves the active release through `file_server`;
- proxies only the route set defined below to `127.0.0.1:8787`;
- keeps the original public `Host`, `Origin`, `Referer`, `Cookie`, and `Set-Cookie` behavior;
- does not enable a public admin endpoint, on-demand TLS, wildcard host, wildcard CORS, or response
  caching for protected routes.

The package is installed while `caddy.service` is temporarily masked because the official package
starts its service automatically. The packaged default configuration must never acquire a listener.
The mask is removed only after the reviewed configuration, source firewall, and service ownership
checks pass. If Caddy was already installed or configured by another owner, preflight stops instead of
overwriting it.

The design relies on Caddy's documented default preservation of the original Host header for a plain
HTTP upstream. Configuration tests must detect any future override to the backend host.

### Firewall boundary

A focused systemd oneshot unit owns a named nftables table used only for Cockpit ingress. Its input
hook drops IPv4 TCP traffic to ports `80` and `443` when the source is not `192.168.122.1`. It has an
accepting default for unrelated traffic and therefore does not redefine SSH or the machine-wide
firewall. Caddy starts only after this rule is installed. Stopping the unit deletes only its named
table.

Caddy additionally binds to the VM's libvirt IPv4 address, not a wildcard or IPv6 address. Acceptance
must prove that no IPv6 or wildcard listener bypasses the rule.

### Control Plane

The existing root-managed service continues to run as `User=radek` with the current filesystem
boundary. Production cutover changes only `CONTROL_PLANE_SECURE_COOKIES` from `false` to `true` in the
protected environment file. The listener stays at `127.0.0.1:8787`. Restarting the service invalidates
existing process-local browser sessions by design; bearer-authenticated operator checks remain
available during recovery.

## Request routing

Only these exact path roots and their descendants are proxied:

- `/auth`
- `/status`
- `/sessions`
- `/approvals`
- `/workers`
- `/providers`
- `/projects`
- `/runs`
- `/incidents`
- `/observability`

The matcher must distinguish an exact root or slash descendant; for example, `/authentic` must not be
treated as `/auth`. Protected responses receive `Cache-Control: no-store` without removing upstream
cookies or other security headers.

For all other routes, Caddy serves an existing static file. A non-API `GET` or `HEAD` whose file does
not exist falls back to `index.html` for client-side navigation. Other methods and path forms do not
fall through to the Control Plane.

Hashed static assets may use a long-lived immutable cache. `index.html`, the service entry document,
uses `no-cache` so a release switch does not pin an obsolete asset graph.

## Browser security policy

The TLS proxy supplies a locally verified policy that permits only same-origin application behavior:

- `Content-Security-Policy` with `default-src 'self'`, `connect-src 'self'`, `script-src 'self'`,
  `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`, and `form-action 'self'`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `Strict-Transport-Security: max-age=300` without `includeSubDomains` or preload, enabled only after
  trusted TLS passes so a failed local CA rollout remains quickly recoverable.

The final CSP is derived from a production build and Playwright evidence. It may not add an external
script, style, font, image, or connection origin merely to make a test pass.

Browser login continues to exchange the shared server-side token for an eight-hour process-local
`autopilot_session` cookie. Under this proxy the cookie must be `Secure`, `HttpOnly`, and
`SameSite=Lax`. Cookie-authenticated mutations must accept the exact `https://autopilot.local` origin
and reject a different Origin or Referer. The token is never embedded in a `VITE_*` value or static
asset.

## CA trust workflow

After isolated TLS issuance, an operator command exports only Caddy's public root certificate. The
certificate fingerprint is displayed in the VM and independently checked on Victus before trust is
installed. Victus installs it under an Autopilot-specific name in the OS trust store. If the active
browser does not consume that store, its dedicated trust import is an explicit operator step and is
verified through the real browser acceptance.

Tests never use `curl -k`, disabled certificate verification, or a browser security exception. Trust
removal instructions and the expected root fingerprint are recorded in the runbook. CA private key
material must not appear in terminal output, copied artifacts, Git, or Autopilot backups.

## Deployment sequence

### Phase A: preflight

1. Confirm the live checkout, deployed SHA, clean status, service health, readiness, unit hashes,
   boundary evidence, and latest valid recovery point.
2. Confirm that `192.168.122.99` is stable across VM reboot and that Victus appears to the VM as
   `192.168.122.1`.
3. Build the Cockpit from the exact candidate SHA with Node 24 and run repository, Cockpit, and browser
   tests.
4. Install the candidate under its versioned release path without changing `current`.
5. Validate the Caddy configuration and nftables input offline.

### Phase B: isolated acceptance on 8443

1. Start an isolated Control Plane on `127.0.0.1:8877` with isolated state, isolated projects, secure
   cookies enabled, and no configured provider.
2. Start an isolated Caddy acceptance instance bound to `192.168.122.99:8443` with the same hostname,
   route policy, and static release intended for production, but with the upstream changed to the
   isolated Control Plane.
3. Restrict `8443` to `192.168.122.1` for the duration of the test.
4. Export and verify the public CA root, install host trust, and verify TLS without bypasses.
5. Exercise static delivery, SPA fallback, headers, liveness, readiness, login, same-origin mutation,
   cross-origin rejection, logout, and headless Cockpit behavior.
6. Stop both isolated instances and prove that ports `8443` and `8877` have no listeners before
   cutover.

Isolated login creates only a process-local browser session in the isolated Control Plane and logs out
before completion. It does not read or mutate live managed state and does not prepare, approve,
dispatch, or invoke a provider run.

### Phase C: production cutover

1. Capture a fresh state backup and recovery drill, plus backups of the protected environment, Caddy
   configuration, release symlink, and owned nftables state.
2. Install and start the dedicated firewall unit.
3. Atomically switch `current` to the accepted release.
4. set `CONTROL_PLANE_SECURE_COOKIES=true`, restart the Control Plane, and confirm the loopback listener.
5. Enable/start or reload Caddy and run the complete production acceptance through
   `https://autopilot.local`.
6. Retain all pre-cutover recovery artifacts until proxy reboot acceptance and owner sign-off.

Every mutating step records whether it completed so rollback restores only state owned by this
cutover. Re-running the procedure must be idempotent or stop with an explicit ownership mismatch.

## Failure handling and rollback

Preflight or isolated-acceptance failure stops before live configuration changes. After Phase C begins,
any failed required check triggers automatic rollback:

1. stop Caddy and the dedicated proxy firewall unit;
2. delete only the named nftables table owned by that unit;
3. restore the previous `current` symlink and Caddy configuration, if any;
4. restore the protected Control Plane environment, including
   `CONTROL_PLANE_SECURE_COOKIES=false` for the prior loopback deployment;
5. restart the Control Plane and verify its loopback liveness, core readiness, boundary report, and
   deterministic no-provider smoke;
6. retain the failed candidate, journal time window, and bounded failure reason for diagnosis.

Rollback never restores managed state from a backup automatically, because proxy cutover does not
need to mutate canonical Autopilot state. The state backup is a recovery point, not an automatic
overwrite source. TLS verification, CSRF validation, filesystem containment, or provider gates may
not be weakened to make cutover pass.

If host trust fails, the deployment remains on loopback and the operator repairs or removes the local
CA trust explicitly. If Caddy fails after a later reboot, the Control Plane remains loopback-only and
bearer-authenticated VM checks remain available; it is not rebound to a public interface as a fallback.

## Acceptance criteria

Repository and artifact evidence:

- the candidate is one exact clean Git SHA and the installed release matches its build output;
- `npm run verify`, Cockpit tests/build, configuration tests, and `git diff --check` pass;
- Caddy configuration validation and nftables syntax validation pass before service changes;
- package installation does not start the packaged default Caddy service or create an unreviewed
  listener.

TLS and network evidence:

- `autopilot.local` resolves to `192.168.122.99` on Victus;
- the certificate chain is trusted without a bypass and its SAN contains `autopilot.local`;
- HTTP redirects to the exact HTTPS origin;
- Caddy listens only on the intended VM IPv4 ports, the Control Plane listens only on
  `127.0.0.1:8787`, and no acceptance listener remains on `8443` or `8877`;
- Victus can reach `80/443`, while a request originating from a non-host VM source is rejected;
- nftables inspection confirms the named rule and no SSH-rule mutation.

Application and security evidence:

- static assets and SPA navigation load through the production origin;
- all explicit API roots work, while lookalike prefixes and unsupported methods are not accidentally
  proxied;
- liveness and all five core readiness components pass;
- API/auth responses are not cached; immutable assets and `index.html` have the intended distinct
  policies;
- browser security headers are present and Playwright reports no policy-blocked required resource;
- login emits `Secure`, `HttpOnly`, `SameSite=Lax`; valid same-origin mutation passes; mismatched
  Origin/Referer fails; logout invalidates the session;
- the shared token and CA private material are absent from built assets, logs, Git changes, and state
  backups.

Operational evidence:

- the root Control Plane, health timer, maintenance timer, Caddy, and firewall unit are active/enabled
  as designed;
- boundary, backup validation, recovery reconciliation, and deterministic Cockpit smoke pass with
  `provider_invoked=false`;
- after separate explicit owner confirmation, a graceful VM reboot restores the proxy, firewall,
  Control Plane, and timers without manual recovery;
- the post-reboot browser flow again passes through trusted TLS;
- status, work log, configuration, installation, service runbook, troubleshooting, and project
  Decision Mesh impact are recorded before closeout.

## Verification sources

- Local architecture and contracts:
  `docs/architecture/system-overview.md`, `docs/operations/configuration.md`,
  `docs/operations/install-ubuntu-vm.md`, `docs/operations/cockpit-production-auth.md`,
  `cockpit/vite.config.ts`, and the Autopilot Control Plane project Decision Mesh.
- Caddy official installation documentation: <https://caddyserver.com/docs/install>
- Caddy internal TLS documentation: <https://caddyserver.com/docs/caddyfile/directives/tls>
- Caddy reverse proxy documentation:
  <https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
- Caddy file server documentation: <https://caddyserver.com/docs/caddyfile/directives/file_server>
- Caddy bind documentation: <https://caddyserver.com/docs/caddyfile/directives/bind>

The configured Decision Mesh MCP tools were not callable in this session, so the design used the
repo-local project mesh and directly related canonical files as the documented fallback. The stop
condition audit found no public-internet route, new provider authority, product-runtime addition, or
remote connector mutation in the approved host-only scope.

## Implementation boundary

The implementation plan may add focused Caddy configuration, firewall/unit definitions, deployment
and acceptance scripts, deterministic tests, and the documentation updates named above. It must not
change provider configuration, SSH policy, global firewall defaults, Control Plane route semantics,
authentication rules, canonical managed state, or unrelated product code.
