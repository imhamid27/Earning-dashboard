"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACTIVE_QUARTER } from "@/lib/seo";

export default function Header() {
  const pathname = usePathname() || "/";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [quarters, setQuarters] = useState<string[]>([ACTIVE_QUARTER]);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/quarters?v=2")
      .then((r) => r.json())
      .then((j) => { if (j.ok && j.data?.length) setQuarters(j.data); })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close everything on route change.
  useEffect(() => { setMenuOpen(false); setDropOpen(false); }, [pathname]);

  const isOnResults = pathname.startsWith("/results");
  const labelToSlug = (q: string) => q.replace(/ /g, "-");

  const SIMPLE_NAV = [
    { href: "/",                    label: "Dashboard"  },
    { href: "/sectors",             label: "Sectors"    },
    { href: "/market-movers",       label: "Movers"     },
    { href: "/upcoming",            label: "Upcoming"   },
    { href: "/year-in-review/2026", label: "2026 Review"},
  ];

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
              India · Quarterly Results
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {/* Dashboard */}
          <Link
            href="/"
            className={`relative px-3 py-2 text-[13px] font-medium tracking-tight transition-colors
              ${isActive("/") ? "text-core-ink" : "text-core-muted hover:text-core-ink"}`}
          >
            Dashboard
            {isActive("/") && (
              <span className="absolute left-3 right-3 -bottom-[9px] h-[2px] bg-core-pink" aria-hidden />
            )}
          </Link>

          {/* Quarters dropdown */}
          <div ref={dropRef} className="relative">
            <button
              type="button"
              onClick={() => setDropOpen((v) => !v)}
              className={`relative flex items-center gap-1 px-3 py-2 text-[13px] font-medium tracking-tight transition-colors
                ${isOnResults ? "text-core-ink" : "text-core-muted hover:text-core-ink"}`}
            >
              Quarters
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
                className={`transition-transform duration-150 ${dropOpen ? "rotate-180" : ""}`}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isOnResults && (
                <span className="absolute left-3 right-3 -bottom-[9px] h-[2px] bg-core-pink" aria-hidden />
              )}
            </button>

            {dropOpen && (
              <div className="absolute top-full left-0 mt-2 w-36 bg-white border border-core-line rounded-lg shadow-lg py-1 z-50">
                {quarters.map((q) => {
                  const slug = labelToSlug(q);
                  const href = `/results/${slug}`;
                  const active = pathname === href;
                  return (
                    <Link
                      key={q}
                      href={href}
                      className={`block px-4 py-2 text-[13px] font-medium transition-colors
                        ${active
                          ? "text-core-pink bg-core-pink/5"
                          : "text-core-ink hover:bg-core-bg hover:text-core-pink"
                        }`}
                    >
                      {q}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sectors + Upcoming */}
          {SIMPLE_NAV.slice(1).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative px-3 py-2 text-[13px] font-medium tracking-tight transition-colors
                ${isActive(n.href) ? "text-core-ink" : "text-core-muted hover:text-core-ink"}`}
            >
              {n.label}
              {isActive(n.href) && (
                <span className="absolute left-3 right-3 -bottom-[9px] h-[2px] bg-core-pink" aria-hidden />
              )}
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
      {menuOpen && (
        <div className="md:hidden border-t border-core-line bg-white">
          <nav className="container-core py-3 flex flex-col">
            <Link
              href="/"
              className={`py-3 text-[15px] font-medium border-b border-core-line
                ${isActive("/") ? "text-core-pink" : "text-core-ink"}`}
            >
              Dashboard
            </Link>

            {/* Quarters section — always expanded on mobile */}
            <div className="border-b border-core-line">
              <div className="py-2 text-[11px] uppercase tracking-[0.14em] text-core-muted">
                Quarters
              </div>
              {quarters.map((q) => {
                const href = `/results/${labelToSlug(q)}`;
                return (
                  <Link
                    key={q}
                    href={href}
                    className={`py-2.5 pl-3 text-[15px] font-medium flex items-center gap-2
                      ${pathname === href ? "text-core-pink" : "text-core-ink"}`}
                  >
                    <span className="w-1 h-1 rounded-full bg-current opacity-40" />
                    {q}
                  </Link>
                );
              })}
            </div>

            <Link
              href="/sectors"
              className={`py-3 text-[15px] font-medium border-b border-core-line
                ${isActive("/sectors") ? "text-core-pink" : "text-core-ink"}`}
            >
              Sectors
            </Link>
            <Link
              href="/market-movers"
              className={`py-3 text-[15px] font-medium border-b border-core-line
                ${isActive("/market-movers") ? "text-core-pink" : "text-core-ink"}`}
            >
              Movers
            </Link>
            <Link
              href="/upcoming"
              className={`py-3 text-[15px] font-medium border-b border-core-line
                ${isActive("/upcoming") ? "text-core-pink" : "text-core-ink"}`}
            >
              Upcoming
            </Link>
            <Link
              href="/year-in-review/2026"
              className={`py-3 text-[15px] font-medium border-b border-core-line
                ${isActive("/year-in-review") ? "text-core-pink" : "text-core-ink"}`}
            >
              2026 Review
            </Link>
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
      )}
    </header>
  );
}
