// Pulls every economy indicator from its source module. One failed source
// never blanks the page: each series carries its own error.
import { ABS_SERIES, fetchAbs } from "./sources/abs";
import { RBA_SERIES, fetchRba } from "./sources/rba";
import { fetchAgs } from "./sources/aofm";
import { DERIVED } from "./derived";
import type { Series, SeriesResult } from "./sources/types";

// Display order, grouped the way the economy page lays them out.
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Recession signals", ids: ["sahm-rule", "yield-curve", "bond-10y"] },
  { title: "Growth", ids: ["gdp-growth", "gdp-per-capita", "population", "births"] },
  { title: "Prices and rates", ids: ["cpi", "cash-rate", "aud-usd"] },
  { title: "Cost of living", ids: ["cpi-rents", "cpi-electricity", "cpi-gas", "cpi-food", "cpi-fuel", "credit-card-debt"] },
  { title: "Housing supply", ids: ["building-approvals", "dwellings-completed", "population-change", "housing-pressure"] },
  { title: "Jobs, pay and profits", ids: ["unemployment", "wages", "company-profits"] },
  { title: "Households and trade", ids: ["household-spending", "saving-ratio", "terms-of-trade"] },
];

export const HEADLINE_IDS = ["gdp-growth", "cpi", "unemployment", "cash-rate", "wages", "aud-usd"];

export async function getIndicators(ids?: string[]): Promise<SeriesResult[]> {
  // A derived indicator needs its inputs fetched even when only it was asked for.
  const wanted = ids && new Set(ids.flatMap((id) => [id, ...(DERIVED.find((d) => d.id === id)?.inputs ?? [])]));
  const jobs = [
    ...ABS_SERIES.map((s) => ({ id: s.id, label: s.label, run: () => fetchAbs(s) })),
    ...RBA_SERIES.map((s) => ({ id: s.id, label: s.label, run: () => fetchRba(s) })),
    { id: "ags-on-issue", label: "Government securities on issue", run: () => fetchAgs() }, // shown on the budget page
  ].filter((j) => !wanted || wanted.has(j.id));

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const results: SeriesResult[] = jobs.map((j, i) => {
    const r = settled[i];
    return r.status === "fulfilled"
      ? { id: j.id, label: j.label, series: r.value, error: null }
      : { id: j.id, label: j.label, series: null, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });

  const byId = new Map(results.map((r) => [r.id, r]));
  for (const d of DERIVED) {
    if (ids && !ids.includes(d.id)) continue;
    const inputs = d.inputs.map((id) => byId.get(id));
    const missing = d.inputs.filter((id, i) => !inputs[i]?.series);
    results.push(
      missing.length
        ? { id: d.id, label: d.label, series: null, error: `needs ${missing.join(", ")}` }
        : { id: d.id, label: d.label, series: d.build(inputs.map((r) => r!.series!)), error: null },
    );
  }
  return ids ? results.filter((r) => ids.includes(r.id)) : results;
}

export const latest = (s: Series) => s.points[s.points.length - 1];

// Change against the previous observation, in the series' own unit.
export function change(s: Series): number | null {
  if (s.points.length < 2) return null;
  return s.points[s.points.length - 1].value - s.points[s.points.length - 2].value;
}
