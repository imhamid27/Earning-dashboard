# Deploying to Coolify

The repo is deployment-ready for any Coolify instance. Two paths below — pick
one based on how your Coolify is configured.

---

## Prerequisites

- A running Coolify instance (≥ v4.x) with access to the server's docker daemon
- A GitHub source connected to Coolify (or you can use the public Git URL
  variant — not applicable for a private repo)
- Your Supabase credentials from the `.env` file used locally

---

## 1. Create the application

1. Open your Coolify dashboard
2. **+ New Resource** → **Application**
3. **Source**: pick the GitHub source connected to `imhamid27`
4. **Repository**: `imhamid27/Earning-dashboard`
5. **Branch**: `main`
6. **Build pack**: **Dockerfile** (recommended — uses the committed `Dockerfile`)
   - Alternatively, **Nixpacks** will also work since we have a standard
     Next.js project; Coolify auto-detects and sets port 3000.

---

## 2. Environment variables

In the application's **Environment Variables** tab, add these. Mark
`SUPABASE_SERVICE_ROLE_KEY` as a **build secret** — it should never surface
in the client bundle.

| Name | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL | Build + Runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | Build + Runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | **Runtime only** |
| `NEXT_PUBLIC_DEFAULT_QUARTER` | `Q4 FY26` | Build + Runtime |

The `NEXT_PUBLIC_*` vars are baked into the client bundle at build time — if
you change them later, trigger a rebuild from the Coolify UI.

---

## 3. Ports + domain

- **Exposed port**: `3000` (the Dockerfile exposes this and sets `HOSTNAME=0.0.0.0`)
- **Domain**: add your domain (e.g. `earnings.thecore.in`) under the app's
  **Domains** tab. Coolify handles the Traefik routing + TLS cert automatically.

---

## 4. Deploy

Click **Deploy** in Coolify. First build takes ~3–5 minutes:

- `deps` stage installs 172 npm packages
- `builder` stage runs `next build`
- `runner` stage ships the standalone output

The healthcheck (`/api/quarters`) is exercised every 30 s; Coolify waits for
three successful probes before marking the deployment healthy and cutting
traffic over.

---

## 5. Auto-deploy on push

In the application's **Git** tab, enable **Automatic deployment**. Coolify will
watch `main` and redeploy on every push. For PR previews, enable
**Preview deployments**.

---

## Ingestion jobs (Python)

The ingestion pipeline (`scripts/*.py`) is intentionally **not** part of the
web container — it runs on its own cadence. Two options:

### Option A — Coolify Scheduled Tasks (recommended)

In the web application's **Scheduled Tasks** tab:

| Cron | Command | Purpose |
|---|---|---|
| `30 2 * * 1-5` | `python scripts/nse_calendar.py && python scripts/bse_calendar.py && python scripts/moneycontrol_calendar.py` | Daily calendar refresh |
| `*/30 4-16 * * 1-5` | `python scripts/nse_results.py` | Hourly filings fetch |
| `0 18 * * 0` | `python scripts/nse_results.py --all --quarters 2 && python scripts/screener_results.py --missing` | Weekly backfill |

**Caveat**: the Docker image we ship doesn't include Python. Either bake a
multi-runtime image (Python + Node) or use Option B.

### Option B — GitHub Actions (already committed)

Set the Secrets in GitHub → Settings → Secrets → Actions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The workflow at `.github/workflows/earnings-ingest.yml` handles all three
cadences on hosted runners — no Coolify cron needed.

---

## Troubleshooting

- **Build fails at `deps` stage**: usually a `package-lock.json` mismatch.
  Re-run `npm install` locally, commit the updated lockfile, redeploy.
- **App boots but shows `Missing NEXT_PUBLIC_SUPABASE_URL`**: the `NEXT_PUBLIC_*`
  vars must be set at **Build** time. Check they're marked for both build
  and runtime scopes.
- **Healthcheck never goes green**: SSH into the container, run
  `wget -qO- http://127.0.0.1:3000/api/quarters`. If it returns JSON, Coolify's
  healthcheck config is wrong; if it fails, Supabase credentials are wrong.
- **Webhook not firing**: in GitHub → Settings → Webhooks, confirm the
  Coolify webhook URL is listed and its last delivery was 200.
