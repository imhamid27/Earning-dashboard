-- =====================================================================
-- Deactivate placeholder expert quotes seeded on first deploy.
--
-- The initial seed quotes used generic homepage URLs
-- (e.g. ril.com/investor-relations, infosys.com/investors) rather
-- than specific article / earnings-call transcript links. Per the
-- editorial trust rule ("no dead links, no unverified quotes"), these
-- are deactivated so the Expert Speaks block renders empty until real,
-- sourced quotes are added via the Supabase dashboard.
--
-- HOW TO ADD REAL QUOTES:
--   In Supabase Table Editor → expert_quotes → Insert row.
--   Required fields:
--     expert_name    — full name
--     designation    — e.g. "CEO & MD"
--     firm           — company / institution
--     quote          — max 40 words, verbatim from public source
--     source_url     — direct link to the specific article / transcript
--     source_name    — human-readable source (e.g. "Infosys Q4 FY26 Call")
--     published_date — YYYY-MM-DD
--     is_active      — true
--
-- Run this in Supabase SQL editor once.
-- =====================================================================

update public.expert_quotes
set    is_active = false
where  source_url in (
  'https://www.ril.com/investor-relations',
  'https://www.infosys.com/investors',
  'https://economictimes.indiatimes.com/',
  'https://www.livemint.com/',
  'https://www.asianpaints.com/investors'
)
and is_active = true;
