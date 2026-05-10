/**
 * Renders an FAQ section with both human-readable Q&A markup AND the
 * matching FAQPage JSON-LD. AEO-critical: AI answer engines pick these
 * up reliably when a user query matches a question.
 *
 * Server component — safe to import from any layout or page that itself
 * runs on the server.
 */
import { buildFaqLd } from "@/lib/seo";
import JsonLd from "@/components/JsonLd";

export interface FaqItem {
  q: string;
  a: string;
}

export default function FaqBlock({
  title = "Frequently asked questions",
  items,
  compact = false,
}: {
  title?: string;
  items: FaqItem[];
  compact?: boolean;
}) {
  if (!items?.length) return null;

  return (
    <section
      className={`border-t border-core-line ${compact ? "pt-6 mt-6" : "pt-10 mt-10"}`}
      aria-labelledby="faq-heading"
    >
      <JsonLd data={buildFaqLd(items)} />
      <h2
        id="faq-heading"
        className="text-xl md:text-2xl font-bold tracking-tightest mb-5"
      >
        {title}
      </h2>
      <dl className="space-y-5 max-w-3xl">
        {items.map((item, i) => (
          <div key={i}>
            <dt className="text-base font-semibold text-core-ink leading-snug">
              {item.q}
            </dt>
            <dd className="mt-2 text-[14px] leading-relaxed text-core-muted">
              {item.a}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
