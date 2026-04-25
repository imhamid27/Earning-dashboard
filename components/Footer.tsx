export default function Footer() {
  return (
    <footer className="mt-24 border-t border-core-line">
      <div className="border-t border-core-line bg-core-surface">
        <div className="container-core py-8 grid grid-cols-1 md:grid-cols-3 gap-8 text-xs text-core-muted">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              India Earnings Tracker
            </div>
            <p className="leading-relaxed max-w-sm">
              Tracking quarterly results from India&apos;s listed companies,
              updated as disclosures come in.
            </p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              Sources
            </div>
            <p className="leading-relaxed">
              Earnings data from company filings with{" "}
              <a href="https://www.nseindia.com/" target="_blank" rel="noopener noreferrer" className="hover:text-core-ink">NSE</a>
              {" and "}
              <a href="https://www.bseindia.com/" target="_blank" rel="noopener noreferrer" className="hover:text-core-ink">BSE</a>
              {". Live prices from "}
              <a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer" className="hover:text-core-ink">Yahoo Finance</a>
              {" — may be delayed 15–20 minutes during trading hours."}
            </p>
          </div>
          <div className="md:text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
              The Core
            </div>
            <p className="leading-relaxed">
              Verify with official filings before publishing or making any
              financial decision.
              <br />
              © {new Date().getFullYear()} The Core.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
