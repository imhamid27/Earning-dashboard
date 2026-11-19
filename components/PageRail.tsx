import type { ReactNode } from "react";
import SponsoredCard from "@/components/SponsoredCard";

// Content column plus a narrow rail. The rail holds the sponsored card, which stays in view on wide
// screens and comes first on phones (a short card right after the masthead). Used by every page whose
// body is a list or table, so the offer sits beside the content instead of inside it.
export default function PageRail({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="order-2 min-w-0 space-y-8 md:space-y-10 lg:order-1">{children}</div>
      <div className="order-1 lg:sticky lg:top-20 lg:order-2">
        <div><SponsoredCard tile="" /></div>
      </div>
    </div>
  );
}
