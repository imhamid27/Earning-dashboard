export default function Footer() {
  return (
    <footer className="mt-24 border-t border-core-line">
      {/* Global trust line — one place, one sentence, not repeated per card. */}
      <div className="container-core py-5 text-[12px] text-core-muted">
        Data updated from company filings and exchange disclosures.
      </div>
      <div className="border-t border-core-line bg-core-surface">
        <div className="container-core py-8 grid grid-cols-1 md:grid-cols-2 gap-8 text-xs text-core-muted">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              India Earnings Tracker
            </div>
            <p className="leading-relaxed max-w-sm">
              Tracking quarterly results from India&apos;s listed companies, updated as disclosures come in.
            </p>
          </div>
          <div className="md:text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              The Core
            </div>
            <p className="leading-relaxed">
              Based on company disclosures. Verify before use.
              <br />
              © {new Date().getFullYear()} The Core.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
