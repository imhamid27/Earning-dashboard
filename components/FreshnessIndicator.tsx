import { timeAgo } from "@/lib/format";

// Small pill showing when data was last refreshed. Color darkens from
// brand-teal when fresh → amber after 24h → red after a week.
export default function FreshnessIndicator({ fetchedAt }: { fetchedAt: string | null | undefined }) {
  const ageHours = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 36e5 : Infinity;
  let cls = "bg-core-surface text-core-muted border-core-line";
  if (ageHours > 24 * 7)  cls = "bg-red-50 text-red-700 border-red-200";
  else if (ageHours > 24) cls = "bg-amber-50 text-amber-800 border-amber-200";
  else if (fetchedAt)     cls = "bg-[#E7F7F2] text-core-teal border-[#BFE9DD]";
  return (
    <span className={`chip ${cls}`} title={fetchedAt ?? "no data"}>
      <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
      Updated {timeAgo(fetchedAt)}
    </span>
  );
}
