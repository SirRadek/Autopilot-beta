# Radeq — project architecture (governance record)

Radeq (radeq.cz) is a Cloudflare-hosted marketing site with a D1-backed lead
capture form. This is Autopilot's redacted governance record of the project; the
project's own code and runtime logs live in the Radeq repo, not here
(OBS-SCOPE-001).

Governance boundaries are declared in `decision-mesh/`:

- **lead_capture_pipeline** — the lead form must validate on both client and
  server before writing to D1 (`RAD-LEADS-001`, blocker).
- **runtime_observability_boundary** — deploy-log / console / Core-Web-Vitals
  diagnostics stay project-scoped and redacted; raw logs are never copied into
  Autopilot (`RAD-OBS-001`).
