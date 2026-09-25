// Recession watch: a handful of well-known warning signs, each read off a stored
// series with a fixed rule. No probability is invented. The reading is how many
// signs are showing, and every rule is printed next to its result.
import type { Series, SeriesResult } from "./sources/types";
import { value as fmt, period } from "./format";

export type Status = "clear" | "watch" | "triggered";

export type Signal = {
  id: string;
  name: string;
  seriesId: string; // chart to link to on the economy page
  status: Status;
  reading: string; // the figure the rule was applied to, in words
  asOf: string; // period of the latest figure
  rule: string; // exactly when it goes to watch and to triggered
};

export type Watch = {
  level: "Low" | "Elevated" | "High";
  triggered: number;
  watch: number;
  total: number;
  signals: Signal[];
  missing: string[]; // series that didn't load, so their signal is absent
  method: string;
};

// Every series the watch reads. Pages that show it fetch these.
export const WATCH_INPUTS = ["sahm-rule", "yield-curve", "gdp-growth", "gdp-per-capita", "household-spending", "cpi"];

const last = (s: Series, n = 1) => s.points[s.points.length - n]?.value;

export function recessionWatch(results: SeriesResult[]): Watch {
  const byId = new Map(results.filter((r) => r.series).map((r) => [r.id, r.series!]));
  const missing: string[] = [];
  const signals: Signal[] = [];
  const need = (id: string): Series | null => {
    const s = byId.get(id);
    if (!s) missing.push(id);
    return s ?? null;
  };

  const sahm = need("sahm-rule");
  if (sahm) {
    const v = last(sahm);
    signals.push({
      id: "sahm", name: "Unemployment rising (Sahm rule)", seriesId: "sahm-rule",
      status: v >= 0.5 ? "triggered" : v >= 0.3 ? "watch" : "clear",
      reading: `${fmt(v, "pts", 2)} above its 12-month low`, asOf: period(sahm.points[sahm.points.length - 1].period),
      rule: "Watch at 0.30 points, triggered at 0.50 points.",
    });
  }

  const curve = need("yield-curve");
  if (curve) {
    const v = last(curve);
    signals.push({
      id: "curve", name: "Yield curve inverted", seriesId: "yield-curve",
      status: v < 0 ? "triggered" : v < 0.25 ? "watch" : "clear",
      reading: `10-year minus 2-year bond yield is ${fmt(v, "pts", 2)}`, asOf: period(curve.points[curve.points.length - 1].period),
      rule: "Watch below 0.25 points, triggered below zero.",
    });
  }

  const gdp = need("gdp-growth");
  if (gdp) {
    const a = last(gdp), b = last(gdp, 2);
    signals.push({
      id: "gdp", name: "Economy shrinking", seriesId: "gdp-growth",
      status: a < 0 && b < 0 ? "triggered" : a < 0 ? "watch" : "clear",
      reading: `GDP ${fmt(a, "%")} last quarter, ${fmt(b, "%")} the quarter before`, asOf: period(gdp.points[gdp.points.length - 1].period),
      rule: "Watch after one quarter of falling GDP, triggered after two in a row (the usual definition of a recession).",
    });
  }

  const pc = need("gdp-per-capita");
  if (pc) {
    const a = last(pc), b = last(pc, 2);
    signals.push({
      id: "per-capita", name: "Economy shrinking per person", seriesId: "gdp-per-capita",
      status: a < 0 && b < 0 ? "triggered" : a < 0 ? "watch" : "clear",
      reading: `GDP per person ${fmt(a, "%")} last quarter, ${fmt(b, "%")} the quarter before`, asOf: period(pc.points[pc.points.length - 1].period),
      rule: "Same test as GDP, per person. Population growth can hide a fall in living standards in the headline figure.",
    });
  }

  const spend = need("household-spending"), cpi = need("cpi");
  if (spend && cpi) {
    const s = last(spend), p = last(cpi);
    signals.push({
      id: "spending", name: "Household spending falling in real terms", seriesId: "household-spending",
      status: s < 0 ? "triggered" : s < p ? "watch" : "clear",
      reading: `spending up ${fmt(s, "%")} on a year ago, prices up ${fmt(p, "%")}`, asOf: period(spend.points[spend.points.length - 1].period),
      rule: "Watch when spending grows slower than prices, triggered when spending falls outright.",
    });
  }

  const triggered = signals.filter((s) => s.status === "triggered").length;
  const watch = signals.filter((s) => s.status === "watch").length;
  const level = triggered >= 2 ? "High" : triggered >= 1 || watch >= 2 ? "Elevated" : "Low";
  return {
    level, triggered, watch, total: signals.length, signals, missing,
    method:
      "Five signals, each with a published rule. Low: nothing triggered and at most one on watch. " +
      "Elevated: one triggered, or two or more on watch. High: two or more triggered. " +
      "This is a checklist of warning signs, not a forecast, and no signal is weighted above another.",
  };
}
