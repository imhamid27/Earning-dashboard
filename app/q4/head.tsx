import { siteUrl } from "@/lib/site";

export default function Head() {
  const title = "Q4 Results Tracker";
  const description =
    "Follow Q4 earnings announcements for Indian companies by date, with filed numbers, pending filings, and direct company pages.";
  const canonical = `${siteUrl()}/q4`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
    </>
  );
}
