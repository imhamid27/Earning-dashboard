import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Company Comparison Lab | Compare Quarterly Results",
  description:
    "Compare quarterly revenue, net profit, operating profit and EPS for up to 5 listed Indian companies side-by-side across all reported quarters.",
  openGraph: {
    title: "Company Comparison Lab — India Earnings Tracker",
    description:
      "Compare quarterly results for NSE and BSE listed companies — revenue, profit and EPS trends side by side.",
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
