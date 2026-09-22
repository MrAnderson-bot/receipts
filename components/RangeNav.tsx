import Link from "next/link";
import { RANGES, DEFAULT_DAYS } from "@/lib/sources/austender";

// Time range filter. Sits in one row above everything it scopes.
// The range is part of the path (/spending/7) so every page can be a static file.
export function RangeNav({ base, days, label = "Contracts published in the last" }: { base: string; days: number; label?: string }) {
  return (
    <div className="filters">
      <span>{label}</span>
      <nav aria-label="Time range">
        {RANGES.map((r) => (
          <Link key={r} href={r === DEFAULT_DAYS ? base : `${base}/${r}`} aria-current={r === days ? "page" : undefined}>
            {r} days
          </Link>
        ))}
      </nav>
    </div>
  );
}
