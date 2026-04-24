import { siteUrl } from "@/lib/site";

export default function Head() {
  const title = "Sector Earnings View";
  const description =
    "Compare sector-wise revenue growth and net profit trends across listed Indian companies by quarter.";
  const canonical = `${siteUrl()}/sectors`;

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
