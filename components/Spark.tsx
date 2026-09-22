import type { Point } from "@/lib/sources/types";

// Small trend line for a stat tile. Decorative: the tile states the value.
export function Spark({ points }: { points: Point[] }) {
  const pts = points.slice(-24);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * 100, 22 - ((p.value - min) / span) * 20]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <span className="spark" aria-hidden="true">
      <svg viewBox="0 0 100 24" preserveAspectRatio="none">
        <polyline points={xy.map((p) => p.join(",")).join(" ")} />
      </svg>
      <i style={{ left: `${lx}%`, top: `${(ly / 24) * 100}%` }} />
    </span>
  );
}
