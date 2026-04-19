"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

// Horizontally scrolling tab rail with left/right chevron buttons that
// appear only when there's content to scroll toward. Used on the /q4 page
// so the 30+ date tabs don't get silently clipped.
export default function TabScroller({ children }: { children: ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const recompute = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    recompute();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => recompute();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    // Also re-check after a tick — children may render async.
    const t = setTimeout(recompute, 150);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      clearTimeout(t);
    };
  }, [children]);

  const nudge = (direction: "left" | "right") => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.round(el.clientWidth * 0.6);
    el.scrollBy({ left: direction === "left" ? -step : step, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Left chevron + fade mask */}
      {canLeft ? (
        <>
          <div className="absolute left-0 top-0 bottom-[2px] w-12 bg-gradient-to-r from-white via-white to-transparent pointer-events-none z-10" />
          <button
            type="button"
            aria-label="Scroll dates left"
            onClick={() => nudge("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white border border-core-line shadow-sm flex items-center justify-center text-core-ink hover:border-core-pink hover:text-core-pink transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      ) : null}

      {/* Right chevron + fade mask */}
      {canRight ? (
        <>
          <div className="absolute right-0 top-0 bottom-[2px] w-12 bg-gradient-to-l from-white via-white to-transparent pointer-events-none z-10" />
          <button
            type="button"
            aria-label="Scroll dates right"
            onClick={() => nudge("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white border border-core-line shadow-sm flex items-center justify-center text-core-ink hover:border-core-pink hover:text-core-pink transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      ) : null}

      <div
        ref={scrollerRef}
        className="flex gap-1 overflow-x-auto no-scrollbar scroll-smooth -mb-px"
      >
        {children}
      </div>
    </div>
  );
}
