import type { Metadata } from "next";
import AdTracker from "./AdTracker";

export const metadata: Metadata = {
  title: "Ad tracker",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <AdTracker />;
}
