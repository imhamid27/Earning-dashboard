"use client";

// PriceChip — a compact "₹1,450.20 +0.87%" tag we show next to the ticker
// in dense tables (homepage, Q4 page, sectors, any listing). Uses the
// core palette for up/down so readers see the same visual language
// everywhere. Silent when the price isn't available.
//
// Consumers pass one price record from the `/api/prices` response map.

import React from "react";

type PriceInput = {
  last_price: number | null;
  change_pct: number | null;
};

export default function PriceChip({
  p,
  className = "",
}: {
  p: PriceInput | null | undefined;
  className?: string;
}) {
  if (!p || p.last_price == null) return null;
  const priceText = p.last_price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const pct = p.change_pct;
  const cls = pct == null
    ? "text-core-muted"
    : pct > 0 ? "text-core-teal"
    : pct < 0 ? "text-core-negative"
    : "text-core-muted";
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-core-ink">₹{priceText}</span>
      {pct != null ? (
        <span className={`${cls} font-semibold`}>
          {pct >= 0 ? "+" : ""}{(pct * 100).toFixed(2)}%
        </span>
      ) : null}
    </span>
  );
}
