import { siteUrl } from "@/lib/site";

export default function Head() {
  const title = "Upcoming Results Calendar";
  const description =
    "Browse upcoming earnings dates for listed Indian companies, including large-cap bellwethers and scheduled board meetings.";
  const canonical = `${siteUrl()}/upcoming`;

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
