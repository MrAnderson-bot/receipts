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
];
