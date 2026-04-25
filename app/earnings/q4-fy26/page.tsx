// /earnings/q4-fy26 → canonical redirect to /q4
// SEO alias — Part 13 of the Corporate Earnings Dashboard upgrade.
// Keeps the friendlier /earnings/ prefix for external links + search,
// while the live UI lives at /q4 (existing page, unchanged).

import { redirect } from "next/navigation";

export const metadata = {
  title: "Q4 FY26 Earnings Results — India Corporate Earnings Dashboard",
  description:
    "All Q4 FY26 quarterly results from India's listed companies — revenue, net profit, YoY growth. Updated as filings land with NSE and BSE.",
  alternates: { canonical: "/q4" },
};

export default function EarningsQ4FY26Page() {
  redirect("/q4");
}
