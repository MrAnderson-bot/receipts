"use client";

import { useState } from "react";
import type { Series } from "@/lib/sources/types";
import { value as fmt, period } from "@/lib/format";

// Round tick values covering [min, max].
function ticks(min: number, max: number, target = 4): number[] {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 0.999; t += step) out.push(Number(t.toFixed(10)));
  return out;
}

// Single-series line chart. Axis text is HTML so it stays crisp at any width;
// the SVG holds only the marks and stretches to fit.
export function LineChart({ series }: { series: Series }) {
  const pts = series.points;
  const [active, setActive] = useState<number | null>(null);

  const vals = pts.map((p) => p.value);
  const tk = ticks(Math.min(...vals), Math.max(...vals));
  const lo = tk[0], hi = tk[tk.length - 1];
  const x = (i: number) => (pts.length === 1 ? 50 : (i / (pts.length - 1)) * 100);
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join("");
  // Tick labels need one more decimal than the step implies, never fewer than zero.
  const tickDecimals = Math.max(0, -Math.floor(Math.log10(tk[1] - tk[0]) + 1e-9));
  const last = pts.length - 1;
  const base = lo < 0 && hi > 0 ? y(0) : 100; // the wash hangs off zero when the series crosses it
  const shown = active ?? last;

  const move = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setActive(Math.round(f * last));
  };

  return (
    <figure className="line-chart">
      <div className="plot-row">
        <div className="y-axis" aria-hidden="true">
          {tk.map((t) => (
            <span key={t} style={{ top: `${y(t)}%` }}>
              {series.unit === "people" ? fmt(t, "people", 1) : fmt(t, series.unit, tickDecimals)}
            </span>
          ))}
        </div>
        <div
          className="plot"
          tabIndex={0}
          role="img"
          aria-label={`${series.label}, ${period(pts[0].period)} to ${period(pts[last].period)}. Latest ${fmt(pts[last].value, series.unit, series.decimals)}. Use arrow keys to read values.`}
          onPointerMove={(e) => move(e.clientX, e.currentTarget)}
          onPointerDown={(e) => move(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setActive(Math.min(last, Math.max(0, shown + (e.key === "ArrowRight" ? 1 : -1))));
          }}
        >
          {tk.map((t) => (
            <span key={t} className={t === 0 ? "grid zero" : "grid"} style={{ top: `${y(t)}%` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="area" d={`${line}L${x(last)},${base}L${x(0)},${base}Z`} />
            <path className="stroke" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          {active !== null && <span className="cross" style={{ left: `${x(active)}%` }} />}
          <span className="dot" style={{ left: `${x(shown)}%`, top: `${y(pts[shown].value)}%` }} />
          {active !== null && (
            <span
              className="tip"
              style={x(active) > 60 ? { right: `${100 - x(active)}%` } : { left: `${x(active)}%` }}
            >
              <strong>{fmt(pts[active].value, series.unit, series.decimals)}</strong>
              <span>{period(pts[active].period)}</span>
            </span>
          )}
        </div>
      </div>
      <figcaption>
        <span>{period(pts[0].period)}</span>
        <span>{period(pts[last].period)}</span>
      </figcaption>
    </figure>
  );
}
