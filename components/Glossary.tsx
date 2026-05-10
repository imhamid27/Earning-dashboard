/**
 * Earnings glossary — explains common metrics (QoQ, YoY, EPS, etc.) in
 * plain English. Rendered as a definition list so search engines and AI
 * answer engines can extract individual term/definition pairs.
 *
 * Server component. Drop into any page that surfaces these metrics.
 */
import JsonLd from "@/components/JsonLd";

const TERMS: Array<{ term: string; def: string }> = [
  {
    term: "Revenue",
    def: "Total income a company earns in the quarter from its core business — sales of goods or services. Reported on a consolidated basis where available.",
  },
  {
    term: "Net Profit (PAT)",
    def: "Profit After Tax — what's left after a company pays for everything: costs, interest, taxes, and one-time items. The bottom line on the income statement.",
  },
  {
    term: "Operating Profit (EBITDA)",
    def: "Earnings Before Interest, Tax, Depreciation and Amortisation — how profitable the business is from operations alone, before financing and accounting choices.",
  },
  {
    term: "EPS",
    def: "Earnings Per Share — net profit divided by the number of outstanding shares. A common per-unit profitability gauge.",
  },
  {
    term: "QoQ",
    def: "Quarter over Quarter — change vs the immediately preceding quarter. Useful for spotting near-term momentum but seasonally noisy.",
  },
  {
    term: "YoY",
    def: "Year over Year — change vs the same quarter a year ago. Cleaner read on growth because it removes seasonality.",
  },
  {
    term: "Fiscal Year (FY)",
    def: "Indian companies typically follow an April–March fiscal year. FY26 means the year ending March 2026; Q4 FY26 covers Jan–Mar 2026.",
  },
];

// DefinedTerm JSON-LD for AEO — each term is independently extractable.
const GLOSSARY_LD = {
  "@context": "https://schema.org",
  "@type": "DefinedTermSet",
  name: "Indian Earnings Metrics Glossary",
  hasDefinedTerm: TERMS.map((t) => ({
    "@type": "DefinedTerm",
    name: t.term,
    description: t.def,
  })),
};

export default function Glossary({
  heading = "Glossary",
  compact = false,
}: {
  heading?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={`border-t border-core-line ${compact ? "pt-6 mt-6" : "pt-10 mt-10"}`}
      aria-labelledby="glossary-heading"
    >
      <JsonLd data={GLOSSARY_LD} />
      <h2
        id="glossary-heading"
        className="text-xl md:text-2xl font-bold tracking-tightest mb-5"
      >
        {heading}
      </h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 max-w-4xl">
        {TERMS.map((t) => (
          <div key={t.term}>
            <dt className="text-sm font-bold text-core-ink uppercase tracking-[0.08em]">
              {t.term}
            </dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-core-muted">
              {t.def}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
