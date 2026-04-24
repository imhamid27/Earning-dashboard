// Number + currency formatters tuned for Indian financial reporting.
// Financial values are always rendered in Crores for comparability.

const CRORE = 1e7;

export function formatINR(
  value: number | null | undefined,
  opts: {
    precision?: number;
    missingLabel?: string;
    invalid?: boolean;
    invalidLabel?: string;
    zeroLabel?: string;
  } = {}
): string {
  const {
    precision = 2,
    missingLabel = "Data not available",
    invalid = false,
    invalidLabel = "Data not available",
    zeroLabel,
  } = opts;

  if (invalid) return invalidLabel;
  if (value == null || !Number.isFinite(value)) return missingLabel;
  if (value === 0 && zeroLabel) return zeroLabel;

  const sign = value < 0 ? "-" : "";
  const crores = Math.abs(value) / CRORE;
  const formatted = crores.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  });
  return `${sign}₹${formatted} Cr`;
}

export function formatPct(
  value: number | null | undefined,
  digits = 1,
  opts: { label?: string | null; missingLabel?: string } = {}
): string {
  if (opts.label) return opts.label;
  if (value == null || !Number.isFinite(value)) return opts.missingLabel ?? "Data not available";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function pctToneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-core-muted";
  if (value > 0) return "text-core-teal";
  if (value < 0) return "text-core-negative";
  return "text-core-muted";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Data not available";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Data not available";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diffS = Math.max(0, (Date.now() - then) / 1000);
  if (diffS < 60) return `${Math.floor(diffS)}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  if (diffS < 86400 * 30) return `${Math.floor(diffS / 86400)}d ago`;
  return `${Math.floor(diffS / (86400 * 30))}mo ago`;
}
