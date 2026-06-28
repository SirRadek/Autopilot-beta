# Free Lead Capture on Cloudflare

## Goal

Store leads from the CLI Contact Terminal without paid email sending.

## Architecture

```text
Static Astro page
  -> /api/leads Cloudflare Pages Function
  -> LEADS_DB Cloudflare D1 database
  -> manual export / dashboard review
```

Email notification is intentionally not part of v1. Cloudflare D1 stores the lead first, so delivery does not depend on a mailbox, SMTP provider, or paid outbound email feature.

## Data Contract

The terminal sends this JSON shape to `POST /api/leads`:

```json
{
  "name": "Jan Siroky",
  "email": "siroky@radeq.cz",
  "company": "Radeq.cz",
  "project_type": "Service Landing",
  "audience": "Micro-SaaS founders",
  "deadline": "Q3",
  "current_url": "https://example.com",
  "budget_range": "50k-100k CZK",
  "message": "Need fast lead routing.",
  "source_path": "/",
  "referrer": "",
  "locale": "cs-CZ",
  "honeypot": ""
}
```

Required fields:

- `name`
- `email`
- `project_type`
- `message`

## Cloudflare Setup

1. Create the D1 database.

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
npx wrangler d1 create radeq-leads
```

2. Copy `wrangler.example.toml` to `wrangler.toml` and replace `database_id`.

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
Copy-Item .\wrangler.example.toml .\wrangler.toml
```

3. Apply the schema migration.

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
npx wrangler d1 execute radeq-leads --remote --file .\migrations\0001_create_leads.sql
```

4. In Cloudflare Pages, bind the D1 database to the Pages project with this binding name:

```text
LEADS_DB
```

5. Deploy the site. The endpoint path is:

```text
/api/leads
```

## Local Function Test

Astro preview serves the static build, but it does not emulate Cloudflare Pages Functions. For the API, use Wrangler Pages dev after building:

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
npm run build
npx wrangler pages dev .\dist
```

If `LEADS_DB` is not bound, the function returns:

```json
{
  "ok": false,
  "error": "Lead storage is not configured. Bind a Cloudflare D1 database as LEADS_DB."
}
```

## Local D1 Integration Gate

Use this gate before claiming Cloudflare runtime or D1 storage behavior is verified. Keep local account output, database IDs, and auth tokens out of copied logs.

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
npm run test:leads:cloudflare
npm run build
npm run cf:d1:migrate:local
npm run cf:pages:dev
```

In a second terminal, submit a sanitized lead payload to the local Wrangler URL shown by `wrangler pages dev`:

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
$body = @{
  name = "Local Gate"
  email = "local-gate@example.com"
  company = "Example"
  project_type = "Lead pipeline"
  audience = "Founders"
  deadline = "Q3"
  current_url = "http://127.0.0.1:8788/"
  budget_range = "Test"
  message = "Verify local D1 lead routing."
  source_path = "/kontakt?email=fake@example.com&utm_source=private#brief"
  referrer = "https://ads.example/private/path?click_id=fake#campaign"
  locale = "en-US"
  honeypot = ""
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8788/api/leads" -ContentType "application/json" -Body $body
```

Inspect the local D1 database only with sanitized output:

```powershell
# docs/autopilot/free-lead-capture-cloudflare.md
npx wrangler@4.90.1 d1 execute radeq-leads -c .\wrangler.example.toml --local --persist-to .\.wrangler\state\leads-test --command "SELECT id, project_type, source_path, referrer, locale, created_at FROM leads ORDER BY created_at DESC LIMIT 1;"
```

Supervisor acceptance requires a created response, one stored row, minimized `source_path` as `/kontakt`, minimized `referrer` as `https://ads.example`, and no stack traces or secrets in terminal output. Local D1 state is written under `.wrangler/`, which is ignored and must not be committed. The `cf:pages:dev` script creates a temporary root `wrangler.toml` from `wrangler.example.toml` because Wrangler Pages dev does not support custom config paths, then removes it when the process exits.

## Mail Identity Recommendation

Use `siroky@radeq.cz` as the main human mailbox later.

Recommended aliases:

```text
kontakt@radeq.cz -> siroky@radeq.cz
contact@radeq.cz -> siroky@radeq.cz
info@radeq.cz    -> siroky@radeq.cz
```

The lead system does not require paid mail. Notifications can be added later from the stored D1 lead queue.
