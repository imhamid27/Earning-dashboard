// Indian fiscal year utilities.
//   FY runs Apr–Mar. FY26 = 1 Apr 2025 → 31 Mar 2026.
//   Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.

export type FiscalQuarter = 1 | 2 | 3 | 4;

export interface FiscalInfo {
  fiscalYear: number;        // e.g. 2026 for FY26
  fiscalQuarter: FiscalQuarter;
  label: string;             // "Q4 FY26"
  quarterEndDate: string;    // ISO YYYY-MM-DD, canonical quarter close
}

// Map a Date (or ISO string) to the Indian fiscal quarter it falls in.
export function toFiscal(input: Date | string): FiscalInfo {
  const d = typeof input === "string" ? new Date(input) : input;
  const month = d.getUTCMonth() + 1; // 1..12
  const year = d.getUTCFullYear();

  let fq: FiscalQuarter;
  let fyEndCalYear: number;      // the calendar year in which FY ends (e.g. 2026)
  let qEndMonth: number;
  let qEndCalYear: number;

  if (month >= 4 && month <= 6) {
    fq = 1; qEndMonth = 6;  qEndCalYear = year;     fyEndCalYear = year + 1;
  } else if (month >= 7 && month <= 9) {
    fq = 2; qEndMonth = 9;  qEndCalYear = year;     fyEndCalYear = year + 1;
  } else if (month >= 10 && month <= 12) {
    fq = 3; qEndMonth = 12; qEndCalYear = year;     fyEndCalYear = year + 1;
  } else {
    // Jan–Mar — belongs to the FY that ends in the current calendar year.
    fq = 4; qEndMonth = 3;  qEndCalYear = year;     fyEndCalYear = year;
  }

  const fiscalYear = fyEndCalYear;          // FY26 → 2026
  const label = `Q${fq} FY${String(fiscalYear).slice(-2)}`;
  const lastDay = new Date(Date.UTC(qEndCalYear, qEndMonth, 0)).getUTCDate();
  const quarterEndDate = `${qEndCalYear}-${String(qEndMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fiscalYear, fiscalQuarter: fq, label, quarterEndDate };
}

// Parse "Q4 FY26" back into its canonical quarter-end date.
export function labelToQuarterEnd(label: string): string | null {
  const m = /^Q([1-4])\s*FY(\d{2}|\d{4})$/i.exec(label.trim());
  if (!m) return null;
  const fq = Number(m[1]) as FiscalQuarter;
  const rawYr = Number(m[2]);
  const fyEndCalYear = rawYr < 100 ? 2000 + rawYr : rawYr;

  // Q1 ends in Jun (year-1), Q2 Sep (year-1), Q3 Dec (year-1), Q4 Mar (year)
  const spec: Record<FiscalQuarter, { m: number; y: number }> = {
    1: { m: 6,  y: fyEndCalYear - 1 },
    2: { m: 9,  y: fyEndCalYear - 1 },
    3: { m: 12, y: fyEndCalYear - 1 },
    4: { m: 3,  y: fyEndCalYear }
  };
  const { m: mm, y: yy } = spec[fq];
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// Order quarter labels chronologically (oldest → newest).
export function compareQuarterLabels(a: string, b: string): number {
  const da = labelToQuarterEnd(a);
  const db = labelToQuarterEnd(b);
  if (!da || !db) return a.localeCompare(b);
  return da.localeCompare(db);
}
