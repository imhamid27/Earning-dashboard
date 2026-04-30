# India Earnings Tracker

Quarterly earnings tracker for listed Indian companies. Pulls an upcoming-
results calendar from NSE, the actual filed financials from NSE XBRL, uses
Screener.in as a fallback, and (optionally) Yahoo Finance for historical
backfill. Stores everything in Supabase Postgres and serves a Next.js
dashboard styled after [thecore.in](https://www.thecore.in).

- **Frontend:** Next.js 14 (App Router) · Tailwind · Recharts
- **Backend:** Next.js route handlers · Supabase Postgres
- **Ingestion (primary):** Python + NSE JSON APIs + XBRL parsing
- **Ingestion (fallback):** Screener.in HTML scraping
- **Ingestion (backfill):** Yahoo Finance via `yfinance`

---

## Deploying

- **Coolify** (production host): see [DEPLOY.md](DEPLOY.md) — Dockerfile + standalone build + scheduled tasks
- **Local dev**: follow the next section

## Quick start (local)

```bash
# 1. install JS deps
npm install

# 2. copy env + fill in your Supabase keys
cp .env.example .env
# edit .env:
#   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...  (needed for ingestion, keep secret)

# 3. run the SQL schemas in the Supabase SQL editor, in order:
#    - supabase/schema.sql                 (tables, indexes, RLS, seed ~50 companies)
#    - supabase/migration_announcements.sql (BSE scrip codes + announcement_events)

# 4. pull the first batch of data
py -m pip install -r scripts/requirements.txt

# a) scrape NSE event calendar -> populates upcoming results + next_result_date
py scripts/nse_calendar.py

# b) fetch filed financials from NSE XBRL for every tracked company (~8 quarters each)
py scripts/nse_results.py --all --quarters 8

# c) fill any gaps with Screener.in (banks/insurers/post-demerger names)
py scripts/screener_results.py --missing

# 5. run the app
npm run dev
# → open http://localhost:3000
```

First full ingestion takes ~5-8 minutes for 50 companies (rate-limited to be
polite to NSE + Screener).

## Folder layout

```
app/                        Next.js app router pages + route handlers
├── layout.tsx              root shell (header / footer)
├── page.tsx                main dashboard
├── loading.tsx             skeleton
├── company/[ticker]/       per-company detail page
├── sectors/                sector comparison page
├── upcoming/               upcoming-results calendar
└── api/
    ├── companies/          GET /api/companies
    ├── companies/[ticker]/ GET /api/companies/:ticker
    ├── quarterly-results/  GET /api/quarterly-results
    ├── trends/             GET /api/trends?quarter=...
    ├── sectors/            GET /api/sectors?quarter=...
    ├── summary/            GET /api/summary?quarter=...
    ├── upcoming/           GET /api/upcoming
    ├── dashboard/          GET /api/dashboard (combined endpoint)
    └── quarters/           GET /api/quarters

components/                 Reusable presentational components
├── Header.tsx              logo + nav
├── Footer.tsx
├── SummaryCards.tsx        hero KPI tiles
├── CompanyTable.tsx        sortable main table
├── TrendChart.tsx          Recharts line chart
├── SectorComparison.tsx    horizontal bar chart
├── Sparkline.tsx           inline SVG sparkline
├── Controls.tsx            quarter / sector / search
├── FreshnessIndicator.tsx  "refreshed X ago" pill
├── DataQualityBadge.tsx    ok / partial / missing / stale
└── EmptyState.tsx

lib/                        Shared utilities
├── supabase.ts             browser + server clients
├── fiscal.ts               date → "Q4 FY26" + canonical quarter end
├── growth.ts               pctChange, withGrowth (YoY + QoQ)
├── format.ts               ₹123 Cr formatters, ± % tone classes
├── api.ts                  input validation + JSON helpers
├── types.ts                shared TS types
└── tickers.ts              sample 100-ticker universe

scripts/                    Data ingestion
├── nse_common.py           shared curl_cffi session (Chrome TLS impersonation)
├── nse_calendar.py         NSE event calendar → announcement_events
├── nse_results.py          NSE XBRL filings → quarterly_financials (primary)
├── bse_calendar.py         BSE Corpforthresults endpoint (calendar, second source)
├── moneycontrol_calendar.py  Moneycontrol results calendar — catches Q4 filings
                              that NSE's API hasn't exposed yet; auto-triggers
                              Screener for fresh reporters
├── nse_pipeline.py         orchestrator (--daily / --hourly)
├── screener_results.py     Screener.in per-company fallback scraper
├── seed_universe.py        seeds NIFTY 500 into the `companies` table
├── ingest.py               Yahoo Finance backfill (yfinance)
├── ingest.mjs              Yahoo Finance via Node (yahoo-finance2)
├── cron.example.sh         OS cron wrapper
└── requirements.txt        Python deps

supabase/
├── schema.sql                  tables + indexes + RLS + seed data
├── migration_announcements.sql adds announcement_events + BSE scrip codes
├── sample_quarterly_data.sql   optional seed rows (skip if using ingesters)
└── scheduled_job.sql           pg_cron template for daily refresh
```

## API reference

All endpoints return `{ ok: true, data }` or `{ ok: false, error }`. JSON is
cached at the edge for 60s (see `lib/api.ts`).

| Endpoint | Purpose |
|---|---|
| `GET /api/companies?sector=&q=` | Company universe, filterable |
| `GET /api/companies/[ticker]` | Full quarterly history + growth for one ticker |
| `GET /api/quarterly-results?ticker=` | Flat list of rows for one ticker |
| `GET /api/quarterly-results?quarter=Q4 FY26&sector=` | Cross-sectional results |
| `GET /api/trends?quarter=Q4 FY26` | Top gainers / laggards by YoY growth |
| `GET /api/sectors?quarter=Q4 FY26` | Sector aggregates + growth |
| `GET /api/summary?quarter=Q4 FY26` | Hero KPI tiles |
| `GET /api/upcoming` | Companies with future `next_result_date` |
| `GET /api/dashboard?quarter=&sector=&q=&bucket=` | Combined response for the main table |
| `GET /api/quarters` | Distinct quarter labels (most recent first) |

## Data pipeline: what news outlets do

The design mirrors what newsrooms use internally:

```
┌─ Daily 08:00 IST ──────────────────────────────────┐
│ scripts/moneycontrol_calendar.py (fastest signal)   │
│   GET moneycontrol.com/markets/earnings/results-    │
│        calendar/?activeDate=YYYY-MM-DD              │
│   → parse embedded __NEXT_DATA__ for 30-day window  │
│   → upsert announcement_events (one page per day)   │
│   → auto-trigger Screener for recent reporters      │
│                                                     │
│ scripts/nse_calendar.py + scripts/bse_calendar.py   │
│   → cross-verify (via `bse+nse` source tag)         │
│   → populate companies.next_result_date             │
└────────────────────────────────────────────────────┘
                       ↓
┌─ Every hour, 09:30–21:30 IST ──────────────────────┐
│ scripts/nse_results.py (authoritative numbers)      │
│   for each company due today:                       │
│     1. GET /api/corporates-financial-results        │
│     2. download filing XBRL (nsearchives)           │
│     3. parse RevenueFromOperations,                 │
│        ProfitLossForPeriod, BasicEPS, etc.          │
│     4. upsert quarterly_financials                  │
└────────────────────────────────────────────────────┘
                       ↓
┌─ On demand / when NSE's API lags ──────────────────┐
│ scripts/screener_results.py --missing               │
│   scrape /company/<SYMBOL>/consolidated/            │
│   handles:                                          │
│     - banks / insurers (non-standard XBRL schema)   │
│     - post-merger/demerger symbols (TMPV)           │
│     - Q4 reporters NSE hasn't exposed yet           │
│       (fresh filings go through Moneycontrol first) │
└────────────────────────────────────────────────────┘
```

### Why we also scrape Moneycontrol

NSE's public `corporates-financial-results` API lags behind the BSE
announcement-feed that Moneycontrol pulls from. For **Q4 FY26 specifically**,
when a company files late in the day and NSE hasn't published the XBRL yet,
Moneycontrol still shows the company in its calendar — so `moneycontrol_calendar.py`
detects it first, then triggers `screener_results.py` for that ticker to fetch
the actual revenue / profit numbers (Screener reads the same BSE filing).

The result: our "Just landed · Q4 FY26" panel matches Moneycontrol's
`/markets/earnings/results-calendar/` within minutes of a filing.

**Why not hit BSE?** BSE's public JSON API (`api.bseindia.com`) redirects all
script-originated requests to an edge error page. Even Chrome TLS fingerprint
impersonation doesn't bypass it. NSE's API works cleanly as long as you prime
a browser cookie first — which `scripts/nse_common.py` handles.

**Why XBRL?** That's what companies actually file with the exchange, before
they send a media release. It's the same source CNBC-TV18, LiveMint and
Business Standard parse. Every number on the dashboard is traceable back to
a specific XBRL file via `quarterly_financials.raw_json.xbrl`.

## Sources ranked by reliability

| Source | Coverage | Latency | Accuracy | Notes |
|---|---|---|---|---|
| NSE XBRL        | ~45 of 50 large caps | Same-day (post-filing) | Authoritative | Best primary; banks file slightly differently, handled |
| Screener.in     | ~90% of NSE universe | Same-day + ~1h lag    | High          | Fallback for banks/insurers/post-M&A names |
| Yahoo Finance   | Most NSE listings    | 24–72h lag            | Good          | Historical backfill; don't rely on for Q4 |

## Product logic notes

### Indian fiscal year mapping

Encoded in `lib/fiscal.ts` (and duplicated in `scripts/ingest.py`):

| Calendar month | Fiscal quarter | Canonical end date |
|---|---|---|
| Apr–Jun | Q1 | 30 Jun |
| Jul–Sep | Q2 | 30 Sep |
| Oct–Dec | Q3 | 31 Dec |
| Jan–Mar | Q4 | 31 Mar (Q4 of the FY that **ends** in that calendar year) |

> FY26 runs 1 Apr 2025 → 31 Mar 2026. Q4 FY26 = Jan–Mar 2026. This is the
> primary use case: Q4 is when most earnings news happens.

### Upsert semantics

The ingestion script upserts on `(ticker, quarter_end_date)` — see the SQL
comment in `supabase/schema.sql`. Each field is merged with `COALESCE(new, old)`,
which means **a later fetch can't overwrite good historical data with nulls**.
This matters because Yahoo occasionally returns sparse payloads for stocks
that have had corporate actions.

### Data quality

Every quarter row carries a `data_quality_status`:

- `ok` — both revenue and net profit parsed cleanly
- `partial` — one of the two is missing
- `missing` — both missing (row is usually skipped during ingestion)
- `stale` — set manually if a source is known to be behind

The dashboard renders a badge per row so the reader knows not to over-index
on numbers with gaps.

## Scheduling — daily updates as companies announce

Three cadences, same three commands — just pick where to run them:

| When | Mode | What it does |
|---|---|---|
| Weekdays **08:00 / 15:00 / 21:00 IST** (3× a day) | `daily` | Scrape NSE + BSE + Moneycontrol calendars → refresh `announcement_events` and auto-trigger Screener for fresh reporters. Three passes catches pre-market, post-close, and late-evening filing waves |
| Every hour, 09:30–21:30 IST weekdays | `hourly` | Look for filings whose announcement date is today (or within the grace window) and pull their XBRL numbers |
| Sunday 23:30 IST | `backfill` | Full NIFTY 500 sweep + Screener gap-fill. Picks up restated filings |

### Windows (Task Scheduler)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-windows-tasks.ps1
```

Creates three scheduled tasks under `\India Earnings Tracker\` that run the three modes above. Remove with:

```powershell
Unregister-ScheduledTask -TaskPath '\India Earnings Tracker\' -Confirm:$false
```

The tasks call [scripts/cron.ps1](scripts/cron.ps1) which loads `.env`, picks the right Python, and routes to the right pipeline step. Logs land in `logs/earnings-YYYY-MM-DD.log`.

### Linux / Mac (cron)

```bash
crontab scripts/cron.example.crontab
# or append those lines to your existing crontab after editing the path
```

The wrapper ([scripts/cron.example.sh](scripts/cron.example.sh)) takes `daily`, `hourly`, or `backfill` and logs to `logs/`.

### GitHub Actions (cloud — survives laptop-off)

Commit and push the repo; set repository Secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the workflow at [.github/workflows/earnings-ingest.yml](.github/workflows/earnings-ingest.yml) picks up the three schedules automatically.

Trigger a manual run from the Actions tab → "earnings-ingest" → "Run workflow" → pick mode.

### Legacy alternative

**Option A — OS cron (simplest):**
```
45 14 * * 1-5 /path/to/Earning-Dashboard/scripts/cron.example.sh
```
14:45 UTC = 20:15 IST (post market close). See `scripts/cron.example.sh`.

**Option B — Supabase scheduled job (via Edge Function):**
1. Deploy an Edge Function that shells out to the Node ingester, or calls
   a dedicated API route that does the same work.
2. Register the pg_cron job in `supabase/scheduled_job.sql` (update the two
   placeholders before running it).

**Option C — GitHub Actions:**
```yaml
# .github/workflows/ingest.yml
on:
  schedule: [{ cron: "45 14 * * 1-5" }]
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r scripts/requirements.txt
      - run: python scripts/ingest.py
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Limitations of Yahoo Finance data

Read these before trusting a number:

1. **Restatements aren't tracked.** Yahoo only exposes the latest statement.
   If a company restates Q2 FY26 in their Q3 FY26 filing, the old Q2 row in
   our DB won't reflect that unless we re-ingest.
2. **Consolidated-only, and sometimes stale.** Yahoo aggregates consolidated
   statements and can lag the exchange filing by days.
3. **Some sectors are under-covered.** Insurance and banking line items don't
   map cleanly to the standard income statement — `operating_profit` is often
   null for banks. Use segment filings from NSE/BSE for those sectors.
4. **Currency.** We assume INR for `.NS` / `.BO` tickers. Indian ADRs
   (e.g. `INFY` on NYSE) return USD — don't add those.
5. **Field name drift.** Yahoo has used `Total Revenue`, `TotalRevenue`,
   `Revenue`, `Operating Revenue` across their API versions. The defensive
   `pick()` helper in `ingest.py` handles all aliases we've seen; add new
   ones there if you find coverage gaps.
6. **No EPS on some tickers.** `Basic EPS` is occasionally absent. The
   frontend renders "—" — it's a null, not a zero.
7. **Rate limits.** Yahoo will 429 if you hammer it. Keep `INGEST_RPS ≤ 3`.

## What to improve next for production

**Data sourcing (highest leverage)**

1. **Add a Screener.in scraper as a secondary source.** The `source` column
   in `quarterly_financials` is already set up for this — ingest on a second
   track, compare values, and mark rows `partial` when they disagree. Screener
   tends to have cleaner segment data for banks and insurers.
2. **Parse NSE/BSE corporate filings directly** — they publish XBRL now.
   A production ingester should prefer the exchange feed and fall back to
   Yahoo only for historical backfill.
3. **Track announcement calendar** — populate `companies.next_result_date`
   from NSE's `upcoming results` page so the "Upcoming" tab is populated
   automatically.

**Data modelling**

4. **Add a `filings` table** that stores each raw PDF + XBRL alongside the
   parsed financials, so auditors can trace every number back to its source.
5. **Add `restated_at` + `supersedes_id` columns** on `quarterly_financials`
   so restatements don't destroy history.
6. **Add guidance + consensus estimates** (from a paid API like Refinitiv
   or from manual entry) so the dashboard can surface beats/misses.

**App**

7. **Server-render the dashboard** (currently client-fetched). Use Next's
   `revalidate: 60` for ISR so SEO works and initial paint is faster.
8. **Move the dashboard aggregates into a Postgres materialised view** once
   we cross ~500 tickers — the current in-memory aggregation will start to
   show its seams.
9. **Add auth** if you expose this externally. Right now the anon key is
   read-only by policy, which is safe, but rate-limiting middleware would
   still be wise.
10. **Write Playwright tests** for the dashboard's critical path (filter →
    sort → drill into a company).

## Security posture

Aligning with the pre-launch QC. Every choice here is deliberate; swap with
care.

**Secrets** — only two live: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe,
read-only via RLS) and `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
exposed to the client). Supabase RLS policies in [supabase/schema.sql](supabase/schema.sql)
restrict all writes to the service role.

**Input validation** — every `/api/*` query param runs through a strict
sanitiser in [lib/api.ts](lib/api.ts):

| Helper | Pattern | Purpose |
|---|---|---|
| `cleanTicker` | `[A-Z0-9.&-]{1,20}` | Prevents path traversal + shell metacharacters |
| `cleanQuarterLabel` | `Q[1-4]\s*FY\d{2,4}` | Caps to known quarter shape |
| `cleanSearch` | `[A-Za-z0-9 .&'-]{1,60}` + ilike-escape | Blocks wildcard injection via `%` / `_` |
| `cleanSector`, `cleanBucket` | Fixed enums | Closed vocabularies only |

**Rate limiting** — `POST /api/refresh-company` is capped at **5 req/min
per client IP** (forwarded-for aware via Traefik). Implementation in
[lib/rate-limit.ts](lib/rate-limit.ts) — in-memory sliding window, suitable
for single-instance Coolify. Swap for Upstash/Redis at multi-instance scale.

**Subprocess safety** — `/api/refresh-company` spawns a Python scraper with
`child_process.spawn(cmd, [...args])` (never a shell string). Ticker is
validated, re-checked against the `companies` table before spawn, so an
attacker can't probe arbitrary strings.

**HTTP hardening** — configured in [next.config.js](next.config.js):

- **CSP**: `default-src 'self'`; only allows Google Fonts CSS/WOFF,
  thecore.in logo image, and Supabase PostgREST. No inline scripts beyond
  Next's required hydration boot. No `'unsafe-eval'`.
- **HSTS**: `max-age=63072000; includeSubDomains; preload`
- **X-Frame-Options**: `DENY` (can't be embedded)
- **X-Content-Type-Options**: `nosniff`
- **Referrer-Policy**: `strict-origin-when-cross-origin`
- **Permissions-Policy**: revokes camera, mic, geolocation, FLoC/Topics
- **COOP / CORP**: `same-origin` — limits cross-window and cross-origin embeds
- `X-Powered-By` header removed (no Next.js fingerprint)

**XSS** — React auto-escapes everything rendered via JSX. There is no
`dangerouslySetInnerHTML` anywhere in the codebase (grep confirms). All
company names / tickers / sectors come from Supabase (already-sanitised
writes) and render as text nodes.

**SQL injection** — Supabase PostgREST parameterises every query; we build
filter expressions via its builder API, never via string concatenation. The
one `.or()` we use with user input is wildcard-escaped before reaching
PostgREST (see `cleanSearch`).

**Information leakage** — internal field names (`source`, `raw_json`) are
stripped from all API responses. Error messages are generic ("Refresh
failed. Try again in a moment.") to avoid leaking internals.

**Auth** — the dashboard is read-only; there's no user auth to compromise.
The one mutating endpoint (`/api/refresh-company`) is protected by rate
limit + ticker existence check.

## Troubleshooting

- **Dashboard shows "No data yet"** — the ingestion hasn't run. See step 4.
- **Ingestion reports "no quarterly statement available"** — the ticker
  symbol is wrong, or Yahoo doesn't cover that listing. Verify on
  `https://finance.yahoo.com/quote/<TICKER>`.
- **`quoteSummary failed: crumb`** (Node ingester) — Yahoo occasionally
  rotates crumbs; just rerun. The Python path uses a different auth flow
  and is more reliable for batch jobs.
- **Supabase 401 / RLS errors on ingest** — you're using the anon key. The
  ingest script needs `SUPABASE_SERVICE_ROLE_KEY`.

## License

MIT — do whatever, just don't blame us if the numbers are off.
