export default function Footer() {
  return (
    <footer className="mt-24 border-t border-core-line">
      <div className="container-core py-8 grid grid-cols-1 md:grid-cols-2 gap-8 text-xs text-core-muted">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
            India Earnings Tracker
          </div>
          <p className="leading-relaxed max-w-sm">
            Quarterly results from the NIFTY 500 universe. Updated daily as companies report.
          </p>
        </div>
        <div className="md:text-right">
          <div className="text-[11px] uppercase tracking-[0.14em] text-core-ink font-semibold mb-2">
            The Core
          </div>
          <p className="leading-relaxed">
            For editorial use. Verify with source filings before publishing.
            <br />
            © {new Date().getFullYear()} The Core.
          </p>
        </div>
      </div>
    </footer>
  );
}
