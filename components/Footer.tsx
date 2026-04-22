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
              Tracking quarterly results from India&apos;s listed companies,
              updated as disclosures come in. Earnings figures are sourced
              from company filings with{" "}
              <a
                href="https://www.nseindia.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-core-ink"
              >
                NSE
              </a>{" "}
              and{" "}
              <a
                href="https://www.bseindia.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-core-ink"
              >
                BSE
              </a>
              .
            </p>
          </div>
          <div className="md:text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              The Core
            </div>
            <p className="leading-relaxed">
              For informational and editorial use only. Not investment
              advice. Market prices may be delayed 15-20 minutes during
              trading hours — verify against the original filing before
              making any financial decision.
              <br />
              © {new Date().getFullYear()} The Core.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
