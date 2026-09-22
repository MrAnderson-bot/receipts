// Pulls every economy indicator from its source module. One failed source
// never blanks the page: each series carries its own error.
import { ABS_SERIES, fetchAbs } from "./sources/abs";
import { RBA_SERIES, fetchRba } from "./sources/rba";
import type { Series, SeriesResult } from "./sources/types";

// Display order, grouped the way the economy page lays them out.
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Growth", ids: ["gdp-growth", "gdp-per-capita", "population"] },
  { title: "Prices and rates", ids: ["cpi", "cash-rate", "aud-usd"] },
  { title: "Jobs, pay and profits", ids: ["unemployment", "wages", "company-profits"] },
  { title: "Households and trade", ids: ["household-spending", "saving-ratio", "terms-of-trade"] },
];

export const HEADLINE_IDS = ["gdp-growth", "cpi", "unemployment", "cash-rate", "wages", "aud-usd"];

export async function getIndicators(ids?: string[]): Promise<SeriesResult[]> {
  const jobs = [
    ...ABS_SERIES.map((s) => ({ id: s.id, label: s.label, run: () => fetchAbs(s) })),
    ...RBA_SERIES.map((s) => ({ id: s.id, label: s.label, run: () => fetchRba(s) })),
  ].filter((j) => !ids || ids.includes(j.id));

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  return jobs.map((j, i) => {
    const r = settled[i];
    return r.status === "fulfilled"
      ? { id: j.id, label: j.label, series: r.value, error: null }
      : { id: j.id, label: j.label, series: null, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
}

export const latest = (s: Series) => s.points[s.points.length - 1];

// Change against the previous observation, in the series' own unit.
export function change(s: Series): number | null {
  if (s.points.length < 2) return null;
  return s.points[s.points.length - 1].value - s.points[s.points.length - 2].value;
}
