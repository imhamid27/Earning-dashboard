/**
 * Renders a JSON-LD structured-data <script> block.
 *
 * Google parses ld+json from both <head> and <body>, so this component
 * is safe to mount anywhere in the JSX tree. In server components, prefer
 * adding the script directly inside <head> (see layout.tsx). In client
 * components, drop <JsonLd> into the JSX return — the tag appears in the
 * SSR HTML for the initial render (with whatever data is available at that
 * point) and updates on the client once async data resolves.
 */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
