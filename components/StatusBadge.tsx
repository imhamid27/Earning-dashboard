import { formatDate } from "@/lib/format";
import { statusLabel } from "@/lib/insight";
import type { LatestQuarterRow } from "@/lib/types";

// Editorial status chip — replaces the old data-quality badge. Colour keyed
// only to lifecycle stage, never to source/provider.
const TONE: Record<string, string> = {
  announced_with_numbers: "bg-[#E7F7F2] text-core-teal border-[#BFE9DD]",
  announced:              "bg-[#E7F7F2] text-core-teal border-[#BFE9DD]",
  scheduled:              "bg-[#FDF0F6] text-core-pink border-[#F6CADC]",
  awaiting:               "bg-core-surface text-core-muted border-core-line"
};

export default function StatusBadge({
  row,
  variant = "compact"
}: {
  row: LatestQuarterRow;
  variant?: "compact" | "full";
}) {
  const s = row.status ?? "awaiting";
  return (
    <span className={`chip ${TONE[s]}`}>
      {statusLabel(s, row.result_date, row.next_result_date, formatDate, variant)}
    </span>
  );
}
