// /earnings/sectors → canonical redirect to /sectors
// SEO alias — Part 13 of the Corporate Earnings Dashboard upgrade.

import { redirect } from "next/navigation";

export const metadata = {
  title: "Sector-wise Earnings — India Corporate Earnings Dashboard",
  description:
    "Revenue and net-profit growth by sector — Materials, Financials, IT, FMCG and more. Q4 FY26 results, updated as filings land.",
  alternates: { canonical: "/sectors" },
};

export default function EarningsSectorsPage() {
  redirect("/sectors");
}
