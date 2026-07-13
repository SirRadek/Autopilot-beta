# Autopilot Cockpit

Local-development frontend for the loopback Control Plane API. Configure the
The browser uses same-origin API paths by default. Vite development proxies
protected paths to `http://127.0.0.1:8787`; production should use the same
same-origin reverse proxy described below. An explicit `VITE_CONTROL_PLANE_URL`
is still available for isolated development/test clients.

The client accepts an explicit token only for controlled test/service callers.
It does not read `VITE_CONTROL_PLANE_TOKEN`; Vite embeds `VITE_*` values into
browser assets, so never put a reusable Control Plane credential into a build.
Production deployments must use a backend/session proxy or another server-side
authentication mechanism.

The implemented cookie flow and reverse-proxy requirements are documented in
[`docs/operations/cockpit-production-auth.md`](../docs/operations/cockpit-production-auth.md).

Install from the repository root with `npm install`; the root workspace lock
file covers the cockpit package. Run `npm run cockpit:dev`, `npm run cockpit:test`,
or `npm run cockpit:build` from the root.
