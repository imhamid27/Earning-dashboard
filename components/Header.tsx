"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Top bar. Left: The Core logo + app wordmark. Right: desktop = inline nav;
// mobile = hamburger that slides a sheet down from the top. No dot-dash
// divider under the header — kept the chrome clean.

const NAV = [
  { href: "/",         label: "Dashboard" },
  { href: "/q4",       label: "Q4 FY26" },
  { href: "/sectors",  label: "Sectors" },
  { href: "/upcoming", label: "Upcoming" }
];

export default function Header() {
  const pathname = usePathname() || "/";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-core-line">
      <div className="container-core h-14 md:h-16 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 md:gap-3.5 group min-w-0">
          <img
            src="https://www.thecore.in/images/logo.png?v=3"
            alt="The Core"
            className="h-7 md:h-8 w-auto shrink-0"
          />
          <span className="hidden sm:inline-block h-5 md:h-6 w-px bg-core-line" />
          <span className="hidden sm:flex flex-col leading-tight min-w-0">
            <span className="text-[10px] uppercase tracking-[0.18em] text-core-muted">
              Earnings Tracker
            </span>
            <span className="text-[14px] md:text-[15px] font-semibold tracking-tightest text-core-ink truncate">
              India · NIFTY 500
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative px-3 py-2 text-[13px] font-medium tracking-tight transition-colors
                ${isActive(n.href) ? "text-core-ink" : "text-core-muted hover:text-core-ink"}
              `}
            >
              {n.label}
              {isActive(n.href) ? (
                <span className="absolute left-3 right-3 -bottom-[9px] h-[2px] bg-core-pink" aria-hidden />
              ) : null}
            </Link>
          ))}
          <a
            href="https://www.thecore.in"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:inline-flex ml-3 text-[13px] text-core-muted hover:text-core-pink"
          >
            thecore.in ↗
          </a>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-md border border-core-line text-core-ink"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            {menuOpen ? (
              <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <>
                <path d="M2 5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M2 9h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M2 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile drop-down sheet */}
      {menuOpen ? (
        <div className="md:hidden border-t border-core-line bg-white">
          <nav className="container-core py-3 flex flex-col">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`py-3 text-[15px] font-medium border-b border-core-line last:border-none
                  ${isActive(n.href) ? "text-core-pink" : "text-core-ink"}`}
              >
                {n.label}
              </Link>
            ))}
            <a
              href="https://www.thecore.in"
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 text-[13px] text-core-muted"
            >
              thecore.in ↗
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
