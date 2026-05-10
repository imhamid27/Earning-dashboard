/**
 * FAQ accordion — server component, zero JS required.
 * Uses native <details>/<summary> so the markup is fully crawlable AND
 * interactive without hydration. Each question expands/collapses on
 * click; the FAQPage JSON-LD is emitted alongside so AI engines can
 * extract every Q&A regardless of expand state.
 *
 * Design language:
 *   • Two-column eyebrow header (label + count)
 *   • Each row: question (bold), expand chevron (rotates), answer
 *   • Pink left-rule on the open row — subtle brand cue
 *   • Hover: question colour shifts to pink, chevron darkens
 *   • All open by default on first paint so the page reads as a long
 *     editorial block; users can collapse the ones they've read
 */
import { buildFaqLd } from "@/lib/seo";
import JsonLd from "@/components/JsonLd";

export interface FaqItem {
  q: string;
  a: string;
}

export default function FaqBlock({
  title = "Frequently asked questions",
  eyebrow = "FAQ",
  items,
  compact = false,
}: {
  title?: string;
  eyebrow?: string;
  items: FaqItem[];
  compact?: boolean;
}) {
  if (!items?.length) return null;

  return (
    <section
      className={`border-t border-core-line ${compact ? "pt-7 mt-7" : "pt-12 mt-12"}`}
      aria-labelledby="faq-heading"
    >
      <JsonLd data={buildFaqLd(items)} />

      {/* Section header — eyebrow + title + counter. Eyebrow doubles
          as an editorial tag so the section reads as a familiar
          newsroom-style unit. */}
      <header className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] font-bold text-core-pink mb-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-core-pink" />
            {eyebrow}
          </div>
          <h2
            id="faq-heading"
            className="text-2xl md:text-3xl font-extrabold tracking-tightest leading-[1.05]"
          >
            {title}
          </h2>
        </div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-core-muted font-semibold tabular-nums">
          {items.length} {items.length === 1 ? "question" : "questions"}
        </div>
      </header>

      {/* Accordion list — native <details>; first item open on initial
          render so search engines see the answer copy without needing
          to simulate a click, and so readers immediately see what kind
          of answers live in this section. */}
      <div className="border border-core-line rounded-md divide-y divide-core-line bg-white">
        {items.map((item, i) => (
          <details
            key={i}
            // eslint-disable-next-line react/no-unknown-property
            open={i === 0 ? true : undefined}
            className="group faq-row"
          >
            <summary
              className="
                cursor-pointer list-none px-5 py-4 md:px-6 md:py-5
                flex items-start gap-4 select-none
                transition-colors
                hover:bg-[rgba(236,45,122,0.025)]
              "
            >
              {/* Question number — small mono badge, gives the list a
                  scannable spine on long FAQs. */}
              <span className="mt-0.5 shrink-0 inline-flex items-center justify-center w-7 h-7 text-[11px] font-bold tabular-nums rounded-full border border-core-line text-core-muted group-open:border-core-pink group-open:text-core-pink group-open:bg-[rgba(236,45,122,0.06)]">
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* Question text — colour shifts to pink on hover and on
                  the open row. */}
              <span className="flex-1 text-[15px] md:text-[16px] font-bold leading-snug text-core-ink group-hover:text-core-pink group-open:text-core-pink">
                {item.q}
              </span>

              {/* Chevron — rotates 180° when open. Pure CSS via the
                  group-open utility on the parent <details>. */}
              <span
                aria-hidden
                className="mt-1 shrink-0 inline-block w-5 h-5 text-core-muted group-open:text-core-pink transition-transform duration-200 group-open:rotate-180"
              >
                <svg viewBox="0 0 20 20" fill="none" className="w-full h-full">
                  <path
                    d="M5 7.5l5 5 5-5"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </summary>

            {/* Answer block — indented to align with question text
                (matches the badge gutter). max-w-3xl keeps long
                paragraphs readable on wide viewports. */}
            <div className="px-5 pb-5 md:px-6 md:pb-6 -mt-1 md:-mt-1.5">
              <div className="ml-11 max-w-3xl text-[14px] md:text-[15px] leading-relaxed text-core-muted">
                {item.a}
              </div>
            </div>
          </details>
        ))}
      </div>

      {/* Footer line — tiny "ask anything else" link signals this is a
          living section. Subtle, doesn't compete with content. */}
      <div className="mt-4 text-[12px] text-core-muted">
        Have a question that's not here?{" "}
        <a
          href="https://www.thecore.in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-core-pink underline-offset-[3px] hover:underline decoration-2"
        >
          Reach The Core newsroom
        </a>
        .
      </div>
    </section>
  );
}
