// Shared types used across API routes and components.

export interface Company {
  id: string;
  company_name: string;
  ticker: string;
  exchange: string;
  sector: string | null;
  industry: string | null;
  isin: string | null;
  market_cap_bucket: string | null;
  next_result_date: string | null;
  is_active: boolean;
}

export type DataQuality = "ok" | "partial" | "missing" | "stale";

export interface QuarterlyFinancial {
  id: string;
  company_id: string;
  ticker: string;
  quarter_label: string;
  quarter_end_date: string;
  fiscal_year: number;
  fiscal_quarter: number;
  revenue: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  eps: number | null;
  currency: string;
  source: string;
  data_quality_status: DataQuality;
  fetched_at: string;
}

export interface LatestQuarterRow {
  company_id: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
  exchange: string;
  ticker: string;
  quarter_label: string;
  quarter_end_date: string;
  revenue: number | null;
  net_profit: number | null;
  operating_profit: number | null;
  eps: number | null;
  data_quality_status: DataQuality;
  fetched_at: string;
  // Growth fields are computed at the API layer, not stored:
  revenue_yoy?: number | null;
  revenue_qoq?: number | null;
  profit_yoy?: number | null;
  profit_qoq?: number | null;
  // Last 8 quarters of revenue, for sparklines:
  revenue_trend?: Array<{ q: string; v: number | null }>;
  // When the company is scheduled to announce the currently-selected quarter.
  // Only populated on rows that haven't reported yet.
  next_result_date?: string | null;
}
