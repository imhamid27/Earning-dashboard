"use client";

import Link from "next/link";
import { formatDate } from "@/lib/format";

interface UpcomingItem {
  ticker: string;
  company_name: string;
  sector: string | null;
  next_result_date: string;
  source?: string;
}

// Horizontal scrolling strip of the next N result announcements. Each chip
// shows the company, the date, and a days-until badge. Used on the main
// dashboard so readers can always see what's coming this week at a glance.
export default function CalendarStrip({
  items,
  days = 7
}: {
  items: UpcomingItem[];
  days?: number;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + days * 86_400_000);
  const shown = items
    .filter((i) => new Date(i.next_result_date) <= cutoff)
    .slice(0, 12);

  if (shown.length === 0) {
    return (
      <div className="text-sm text-core-muted">No announcements scheduled in the next {days} days.</div>
    );
  }

  // Group by date so adjacent chips with the same date visually cluster.
  const byDate = new Map<string, UpcomingItem[]>();
  for (const i of shown) {
    const arr = byDate.get(i.next_result_date) ?? [];
    arr.push(i);
    byDate.set(i.next_result_date, arr);
  }
  const dates = Array.from(byDate.keys()).sort();

  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
      {dates.map((d) => (
        <DateColumn key={d} date={d} items={byDate.get(d)!} />
      ))}
    </div>
  );
}

function DateColumn({ date, items }: { date: string; items: UpcomingItem[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const rel =
    days === 0 ? "Today" :
    days === 1 ? "Tomorrow" :
    days > 0   ? `In ${days}d` :
                 `${-days}d ago`;
  const isToday = days === 0;

  return (
    <div className={`shrink-0 w-[220px] card p-4 ${isToday ? "border-core-accent/30 bg-red-50/40" : ""}`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="serif text-base">{formatDate(date)}</div>
        <div className={`text-[10px] uppercase tracking-wide ${isToday ? "text-core-accent font-medium" : "text-core-muted"}`}>
          {rel}
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.slice(0, 5).map((i) => (
          <li key={i.ticker + i.next_result_date} className="truncate">
            <Link
              href={`/company/${encodeURIComponent(i.ticker)}`}
              className="hover:text-core-accent"
            >
              {i.company_name}
            </Link>
          </li>
        ))}
        {items.length > 5 ? (
          <li className="text-[11px] text-core-muted pt-1">+{items.length - 5} more</li>
        ) : null}
      </ul>
    </div>
  );
}
