// Default OG image for the entire site.
// Next.js automatically picks this file up and serves it as the
// /opengraph-image for the root route, with the same image cascading to
// every page that doesn't override its own openGraph.images. Same image
// is reused as the Twitter card thumbnail.
//
// Generated with next/og's ImageResponse — no static assets to maintain;
// regenerates if we ever change the layout below.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "India Earnings Tracker — Quarterly Results Dashboard for Listed Indian Companies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #ffffff 0%, #fefcfb 60%, #fde8ee 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top row — wordmark + brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 22,
                letterSpacing: "0.22em",
                fontWeight: 700,
                color: "#9b9b9b",
                textTransform: "uppercase",
              }}
            >
              India Earnings Tracker
            </div>
            <div
              style={{
                fontSize: 18,
                color: "#7a7a7a",
              }}
            >
              By The Core · thecore.in
            </div>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#e91e63",
              padding: "10px 18px",
              borderRadius: 999,
              border: "2px solid #e91e63",
            }}
          >
            LIVE · NSE & BSE
          </div>
        </div>

        {/* Middle — main headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 1040,
          }}
        >
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "#111111",
            }}
          >
            Quarterly Results Dashboard for Listed Indian Companies
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.4,
              color: "#444444",
            }}
          >
            Revenue · Net profit · EPS · YoY growth · Sector trends ·
            Filing PDFs — sourced from official NSE and BSE filings.
          </div>
        </div>

        {/* Bottom — feature row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid #efefef",
            paddingTop: 28,
            fontSize: 22,
            color: "#666666",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#e91e63", fontWeight: 800 }}>1,000+</span>
            <span>companies tracked</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#e91e63", fontWeight: 800 }}>
              Every 2 hours
            </span>
            <span>refresh cycle</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#e91e63", fontWeight: 800 }}>Free</span>
            <span>· no paywall</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
