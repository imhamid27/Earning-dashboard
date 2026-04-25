// /earnings/company/[name] → redirect to /company/[name]
// SEO alias — Part 13 of the Corporate Earnings Dashboard upgrade.
// Accepts the same ticker or company-name slug that /company/[ticker] does.

import { redirect } from "next/navigation";

interface Props {
  params: { name: string };
}

export async function generateMetadata({ params }: Props) {
  const decoded = decodeURIComponent(params.name);
  return {
    title: `${decoded} Earnings Results — India Corporate Earnings Dashboard`,
    description: `Quarterly earnings results for ${decoded} — revenue, net profit, YoY growth across multiple quarters.`,
    alternates: { canonical: `/company/${params.name}` },
  };
}

export default function EarningsCompanyPage({ params }: Props) {
  redirect(`/company/${params.name}`);
}
