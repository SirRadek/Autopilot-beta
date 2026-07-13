# Cockpit production authentication

> **Superseded:** This focused note is retained for historical compatibility. Use canonical
> [Configuration](configuration.md) and [Ubuntu VM installation](install-ubuntu-vm.md).

The Control Plane keeps `CONTROL_PLANE_TOKEN` server-side. Browser access uses
`POST /auth/login` once and receives an eight-hour `HttpOnly`, `SameSite=Lax`
`autopilot_session` cookie. The cookie is held in the Control Plane process and
is never written to Vite assets, `localStorage`, or telemetry. `POST /auth/logout`
invalidates it. CLI and service-to-service callers may continue using
`Authorization: Bearer $CONTROL_PLANE_TOKEN`.

Set `CONTROL_PLANE_SECURE_COOKIES=true` for a TLS deployment. Loopback HTTP
uses the explicit `false` value so the browser can receive the cookie. These
are the only accepted non-empty values; an invalid value fails startup with
`invalid_secure_cookie_configuration` instead of silently weakening cookie policy. Browser
cookie-authenticated mutations require a same-origin `Origin` (or `Referer`)
header; bearer-authenticated CLI calls are not subject to this browser CSRF
check.

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
the login form. Session state is process-local, so restarting the Control
Plane invalidates browser sessions and requires login again.
