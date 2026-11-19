# Ad tracker

Sponsored cards for the earnings site, with a private dashboard at `/private/ad-tracker`.
Offers, switches, edits and sync data live in Supabase, so they survive redeploys.
No cards exist at first. Nothing sponsored shows until you add a draft, check its link and switch it on.

## Setup
1. In the Supabase SQL editor run `supabase/migration_ad_tracker.sql` (tables `ad_offers`, `ad_kv`; row level security on, no policies, server-only).
2. In Coolify set these as **runtime** variables (never build args, never committed):
   `AD_TRACKER_PASSWORD` (8+ chars), optional `AD_TRACKER_USER` (default `admin`), `CUELINKS_API_KEY`, `CUELINKS_CID`,
   `ADMITAD_CLIENT_ID`, `ADMITAD_CLIENT_SECRET`, `ADMITAD_WEBSITE_ID`. `SUPABASE_SERVICE_ROLE_KEY` is already used.
3. Open `/private/ad-tracker` (browser asks for the username and password). Setup tab shows which variables are set, never their values.
4. Scheduled sync: add a Coolify scheduled task in the app container, a few times a day:
   `wget -qO- --header="Authorization: Basic $(printf 'adsuser:%s' "$AD_TRACKER_PASSWORD"|base64)" --header="X-Requested-With: tracker" --header="Content-Type: application/json" --post-data='{}' http://127.0.0.1:3000/api/private/ads/sync`
   (Coolify limits this field to 255 characters, so keep it this short. Use `127.0.0.1`, not `localhost`, and the same username as AD_TRACKER_USER. Adjust if the image has no `wget`; `node -e` with fetch works too.)

## How it works
- The site shows one "Sponsored" card above the footer on matching pages (`lib/ads/pages.ts`). With several live offers for a page it rotates per visitor visit.
- Per offer: Switch on/off, Edit (heading, text, button, note, link, pages), Reset (back to the original copy), Remove.
- Sync reads Cuelinks and Admitad: earnings, suggestions (joined campaigns with a link by default, tick box for the rest), fills missing links on drafts once joined, and auto-pauses a card only when the network says the campaign is gone. Any API doubt changes nothing.
- Before writing card copy, open the affiliate link and confirm where it lands. Keep copy plain; do not state rates you have not seen.

## Security
- `/private/*` and `/api/private/*` need HTTP Basic auth (middleware plus a route-level check), are `noindex` and disallowed in robots.txt.
- Writes also require the `X-Requested-With: tracker` header and a JSON body.
- The public `GET /api/ads?page=` returns only live, unpaused https offers.

## CSP / AdSense
Cards are plain links (`rel="sponsored nofollow"`), so `next.config.js` CSP needs no change. AdSense and GA/GTM are untouched.
