# Cockpit production authentication

> **Superseded:** This focused note is retained for historical compatibility. Use canonical
> [Configuration](configuration.md) and [Ubuntu VM installation](install-ubuntu-vm.md).

Browser access uses an admin username/password at `POST /auth/login` and receives a
32-byte opaque `HttpOnly`, `SameSite=Lax` `autopilot_session` cookie. Only the
SHA-256 digest is persisted under the excluded `STATE_DIR/auth` root. Sessions use
a throttled sliding 30-day expiry and are invalidated when
`credential_generation` changes. The password and raw session token are never
written to Vite assets, `localStorage`, telemetry, or managed-state backups.
`POST /auth/logout` removes the durable session.

Service callers use the separately issued `SERVICE_TOKEN` bearer; the backend
persists only its SHA-256 digest. During this additive compatibility phase,
`CONTROL_PLANE_TOKEN`, legacy `{token}` browser login, and
`Authorization: Bearer $CONTROL_PLANE_TOKEN` remain accepted.

Set `CONTROL_PLANE_SECURE_COOKIES=true` for a TLS deployment. Loopback HTTP
uses the explicit `false` value so the browser can receive the cookie. These
are the only accepted non-empty values; an invalid value fails startup with
`invalid_secure_cookie_configuration` instead of silently weakening cookie policy. Browser
cookie-authenticated mutations require a same-origin `Origin` (or `Referer`)
header. Login itself requires same-origin validation, secure-cookie mode pins the
expected scheme to `https`, and every unsafe cookie-authenticated method is
checked. Bearer-authenticated service calls are exempt.

Deploy the cockpit behind a same-origin reverse proxy. The proxy should serve
the static Vite build and forward `/auth/*`, `/status`, `/sessions`,
`/approvals`, `/workers`, and `/providers/*` to the loopback Control Plane. Do
not put `CONTROL_PLANE_TOKEN` in `VITE_CONTROL_PLANE_TOKEN` for a shared or
production build; Vite embeds every `VITE_*` value in JavaScript assets.

Minimum proxy requirements:

- terminate TLS and redirect HTTP to HTTPS;
- preserve the `Set-Cookie` and `Cookie` headers;
- preserve the public `Host` header (or configure the proxy to pass the public
  origin), because cookie mutation CSRF checks compare `Origin`/`Referer` to it;
- use one exact same-origin path (no wildcard CORS);
- do not cache `/auth/*` or protected API responses;
- restrict the Control Plane listener to loopback (`127.0.0.1`).

The current VM service is intentionally loopback-only. A reverse proxy is not
installed by this phase; local development can use `npm run cockpit:dev` and
the login form. Durable sessions survive a Control Plane restart.
