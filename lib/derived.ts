// Indicators worked out from stored series rather than fetched. Each one names
// its inputs so the page can fetch them, and says exactly how it is calculated
// in its note, because a derived figure is only as trustworthy as its method.
import type { Series } from "./sources/types";

export type DerivedSpec = {
  id: string;
  label: string;
  inputs: string[]; // series ids this needs, all of them
  build: (inputs: Series[]) => Series;
};

// Points that share a period across every input, oldest first.
function aligned(inputs: Series[]): { period: string; values: number[] }[] {
  const maps = inputs.map((s) => new Map(s.points.map((p) => [p.period, p.value])));
  return inputs[0].points
    .filter((p) => maps.every((m) => m.has(p.period)))
    .map((p) => ({ period: p.period, values: maps.map((m) => m.get(p.period)!) }));
}

// The same period one year earlier: 2026-Q2 -> 2025-Q2, 2026-07 -> 2025-07, FY2024-25 -> FY2023-24.
export function yearEarlier(p: string): string {
  const fy = p.match(/^FY(\d{4})-\d{2}$/);
  if (fy) {
    const y = Number(fy[1]) - 1;
    return `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  return `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
}

// Change on the same period a year earlier, in per cent, for every point that has one.
export function yearOnYear(s: Series): Map<string, number> {
  const byPeriod = new Map(s.points.map((p) => [p.period, p.value]));
  const out = new Map<string, number>();
  for (const p of s.points) {
    const base = byPeriod.get(yearEarlier(p.period));
    if (base) out.set(p.period, (p.value / base - 1) * 100);
  }
  return out;
}

// Each point becomes the sum of itself and the n-1 points before it; the first n-1 are dropped.
function rolling(pts: { period: string; values: number[] }[], n: number) {
  return pts.slice(n - 1).map((p, i) => ({
    period: p.period,
    values: p.values.map((_, k) => pts.slice(i, i + n).reduce((sum, q) => sum + q.values[k], 0)),
  }));
}

export const DERIVED: DerivedSpec[] = [
  {
    id: "yield-curve",
    label: "Yield curve",
    inputs: ["bond-10y", "bond-2y"],
    build: ([long, short]) => ({
      id: "yield-curve",
      label: "Yield curve",
      unit: "pts",
      frequency: "monthly",
      decimals: 2,
      note:
        "10-year bond yield minus 2-year bond yield, monthly averages. Below zero the curve is inverted: " +
        "investors expect rates to be cut, which has come before most recessions in Australia and elsewhere.",
      source: "Worked out from RBA Table F2",
      sourceUrl: long.sourceUrl,
      points: aligned([long, short]).map((p) => ({ period: p.period, value: p.values[0] - p.values[1] })),
    }),
  },
  {
    id: "sahm-rule",
    label: "Sahm rule",
    inputs: ["unemployment"],
    build: ([u]) => {
      const avg3 = u.points.slice(2).map((p, i) => ({
        period: p.period,
        value: (u.points[i].value + u.points[i + 1].value + p.value) / 3,
      }));
      // Rise of the three-month average above its lowest point in the previous twelve months.
      const points = avg3.slice(12).map((p, i) => ({
        period: p.period,
        value: p.value - Math.min(...avg3.slice(i, i + 12).map((q) => q.value)),
      }));
      return {
        id: "sahm-rule",
        label: "Sahm rule",
        unit: "pts",
        frequency: "monthly",
        decimals: 2,
        note:
          "Three-month average unemployment rate minus its lowest point in the previous twelve months. " +
          "Claudia Sahm's rule: a rise of 0.5 points or more has marked the start of every US recession since 1970. " +
          "Applied here to the ABS seasonally adjusted rate.",
        source: "Worked out from ABS Labour Force",
        sourceUrl: u.sourceUrl,
        points,
      };
    },
  },
  {
    id: "housing-pressure",
    label: "New residents per new dwelling",
    inputs: ["population-change", "dwellings-completed"],
    build: ([pop, built]) => ({
      id: "housing-pressure",
      label: "New residents per new dwelling",
      unit: "ratio",
      frequency: "quarterly",
      decimals: 1,
      note:
        "Population growth over the latest four quarters divided by dwellings completed over the same four quarters. " +
        "The average Australian household is about 2.5 people, so a figure above that means homes are being finished slower than people are arriving. " +
        "Four quarters are used because migration is seasonal.",
      source: "Worked out from ABS population and Building Activity figures",
      sourceUrl: built.sourceUrl,
      points: rolling(aligned([pop, built]), 4)
        .filter((p) => p.values[1] > 0)
        .map((p) => ({ period: p.period, value: p.values[0] / p.values[1] })),
    }),
  },
  // Added for the government scorecard (lib/scorecard.ts).
  {
    id: "real-wages",
    label: "Real wage growth",
    inputs: ["wages", "cpi-quarterly"],
    build: ([wages, cpi]) => {
      const prices = yearOnYear(cpi);
      return {
        id: "real-wages",
        label: "Real wage growth",
        unit: "pts",
        frequency: "quarterly",
        decimals: 1,
        note:
          "Wage Price Index growth on a year earlier minus Consumer Price Index growth on a year earlier (quarterly index), " +
          "in percentage points. Above zero, pay is growing faster than prices; below zero, a typical wage buys less than it did a year ago.",
        source: "Worked out from ABS Wage Price Index and Consumer Price Index",
        sourceUrl: wages.sourceUrl,
        points: wages.points.flatMap((p) =>
          prices.has(p.period) ? [{ period: p.period, value: p.value - prices.get(p.period)! }] : []),
      };
    },
  },
  {
    id: "public-investment-share",
    label: "Public investment, share of GDP",
    inputs: ["public-investment", "gdp-nominal"],
    build: ([inv, gdp]) => ({
      id: "public-investment-share",
      label: "Public investment, share of GDP",
      unit: "%",
      frequency: "quarterly",
      decimals: 1,
      note:
        "Public sector gross fixed capital formation divided by GDP, both at current prices, seasonally adjusted. " +
        "Covers every level of government and the public corporations: what the public sector puts into roads, rail, hospitals, " +
        "schools, defence equipment and other assets, as a share of everything the economy produces.",
      source: "Worked out from ABS National Accounts",
      sourceUrl: inv.sourceUrl,
      points: aligned([inv, gdp]).map((p) => ({ period: p.period, value: (p.values[0] / p.values[1]) * 100 })),
    }),
  },
  {
    id: "gross-debt-share-gdp",
    label: "Gross debt, share of GDP",
    inputs: ["ags-on-issue", "gdp-nominal"],
    build: ([debt, gdp]) => {
      // GDP over the four quarters to each quarter's end, keyed by that quarter's last month (2026-Q2 -> 2026-06).
      const annual = new Map<string, number>();
      gdp.points.forEach((p, i) => {
        const m = p.period.match(/^(\d{4})-Q([1-4])$/);
        if (i >= 3 && m) {
          annual.set(`${m[1]}-${String(Number(m[2]) * 3).padStart(2, "0")}`, gdp.points.slice(i - 3, i + 1).reduce((sum, q) => sum + q.value, 0));
        }
      });
      const months = [...annual.keys()].sort();
      return {
        id: "gross-debt-share-gdp",
        label: "Gross debt, share of GDP",
        unit: "%",
        frequency: "monthly",
        decimals: 1,
        note:
          "Face value of Australian Government Securities on issue at the end of the month, divided by GDP at current prices " +
          "over the most recent four quarters ended by then. The Budget's fiscal strategy is stated in terms of gross debt as a " +
          "share of GDP; this is the same idea read monthly from the AOFM's register rather than yearly from the Budget.",
        source: "Worked out from the AOFM register and ABS National Accounts",
        sourceUrl: debt.sourceUrl,
        points: debt.points.flatMap((p) => {
          const month = months.filter((k) => k <= p.period).pop();
          return month ? [{ period: p.period, value: (p.value / annual.get(month)!) * 100 }] : [];
        }),
      };
    },
  },
];
