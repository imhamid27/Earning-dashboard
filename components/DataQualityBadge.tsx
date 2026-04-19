import type { DataQuality } from "@/lib/types";

// Small visual cue — ties data-quality to our semantic palette (teal ok,
// amber partial, red missing, muted stale).
const STYLE: Record<DataQuality, string> = {
  ok:      "bg-[#E7F7F2] text-core-teal border-[#BFE9DD]",
  partial: "bg-amber-50 text-amber-800 border-amber-200",
  missing: "bg-red-50 text-red-700 border-red-200",
  stale:   "bg-core-surface text-core-muted border-core-line"
};
const LABEL: Record<DataQuality, string> = {
  ok: "ok", partial: "partial", missing: "no data", stale: "stale"
};

export default function DataQualityBadge({ status }: { status: DataQuality }) {
  return <span className={`chip ${STYLE[status]}`}>{LABEL[status]}</span>;
}
