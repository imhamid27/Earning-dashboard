import { siteUrl } from "@/lib/site";

export default function Head({ params }: { params: { ticker: string } }) {
  const ticker = decodeURIComponent(params.ticker);
  const title = `${ticker} Quarterly Results and Earnings`;
  const description =
    `Track ${ticker} quarterly revenue, net profit, EPS, filing links, and upcoming earnings dates on India Earnings Tracker.`;
  const canonical = `${siteUrl()}/company/${encodeURIComponent(ticker)}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
}
