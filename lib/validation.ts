const CRORE = 1e7;

type CompanyContext = {
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap_bucket?: string | null;
  source?: string | null;
  financial_source?: string | null;
  require_verified?: boolean;
};

type ValidationResult = {
  value: number | null;
  issue: string | null;
};

function logValidation(field: string, ctx: CompanyContext, reason: string) {
  console.error("[data-validation]", {
    company_name: ctx.company_name ?? null,
    field,
    source: ctx.source ?? null,
    financial_source: ctx.financial_source ?? null,
    reason,
  });
}

function hasCredibleFinancialSource(ctx: CompanyContext): boolean {
  const value = (ctx.financial_source ?? "").toLowerCase();
  return value === "nse" || value === "bse_pdf";
}

function isLargeCap(bucket?: string | null): boolean {
  const value = (bucket ?? "").toUpperCase();
  return value === "LARGE" || value === "MEGA";
}

function isBankLike(ctx: CompanyContext): boolean {
  const haystack = `${ctx.company_name ?? ""} ${ctx.sector ?? ""} ${ctx.industry ?? ""}`.toLowerCase();
  return [
    "bank",
    "nbfc",
    "non banking financial",
    "housing finance",
    "financial services",
    "asset management",
  ].some((term) => haystack.includes(term));
}

function asCrores(value: number): number {
  return value / CRORE;
}

function isUnrealisticJump(curr: number | null, prev: number | null): boolean {
  if (curr == null || prev == null) return false;
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return true;
  if (prev <= 0) return false;
  return Math.abs((curr - prev) / prev) > 10;
}

export function validateRevenue(
  value: number | null | undefined,
  ctx: CompanyContext,
  prevValue?: number | null
): ValidationResult {
  if (ctx.require_verified && !hasCredibleFinancialSource(ctx)) {
    const issue = "Awaiting verification from official filing source";
    logValidation("revenue", ctx, issue);
    return { value: null, issue };
  }

  if (value == null || !Number.isFinite(value)) {
    return { value: null, issue: "Data not available" };
  }

  const valueCr = asCrores(value);
  let issue: string | null = null;

  if (isBankLike(ctx) && isLargeCap(ctx.market_cap_bucket) && valueCr < 1000) {
    issue = "Revenue failed large bank/NBFC validation";
  } else if (isBankLike(ctx) && valueCr < 100) {
    issue = "Revenue failed bank/NBFC validation";
  } else if (isLargeCap(ctx.market_cap_bucket) && valueCr < 100) {
    issue = "Revenue failed large-cap validation";
  } else if (isUnrealisticJump(value, prevValue ?? null)) {
    issue = "Revenue failed jump validation";
  }

  if (issue) {
    logValidation("revenue", ctx, issue);
    return { value: null, issue };
  }

  return { value, issue: null };
}

export function validateProfit(
  value: number | null | undefined,
  ctx: CompanyContext,
  prevValue?: number | null
): ValidationResult {
  if (ctx.require_verified && !hasCredibleFinancialSource(ctx)) {
    const issue = "Awaiting verification from official filing source";
    logValidation("net_profit", ctx, issue);
    return { value: null, issue };
  }

  if (value == null || !Number.isFinite(value)) {
    return { value: null, issue: "Data not available" };
  }

  const absCr = Math.abs(asCrores(value));
  let issue: string | null = null;

  if (isLargeCap(ctx.market_cap_bucket) && absCr < 1) {
    issue = "Profit failed large-cap validation";
  } else if (isUnrealisticJump(value, prevValue ?? null)) {
    issue = "Profit failed jump validation";
  }

  if (issue) {
    logValidation("net_profit", ctx, issue);
    return { value: null, issue };
  }

  return { value, issue: null };
}

export function validateMetricPair(
  values: { revenue: number | null | undefined; net_profit: number | null | undefined },
  ctx: CompanyContext,
  prev?: { revenue: number | null | undefined; net_profit: number | null | undefined }
) {
  const revenue = validateRevenue(values.revenue, ctx, prev?.revenue ?? null);
  const netProfit = validateProfit(values.net_profit, ctx, prev?.net_profit ?? null);

  return {
    revenue: revenue.value,
    revenue_issue: revenue.issue,
    net_profit: netProfit.value,
    net_profit_issue: netProfit.issue,
  };
}
