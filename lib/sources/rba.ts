// Reserve Bank of Australia statistical tables (CSV, no key).
// Index of tables: https://www.rba.gov.au/statistics/tables/
import type { Point, Series } from "./types";

type RbaSpec = Omit<Series, "points" | "source" | "sourceUrl"> & {
  file: string; // csv file name under /statistics/tables/csv/
  seriesId: string; // value in the "Series ID" row
  table: string;
  from: string; // earliest period to keep, ISO date
  multiply?: number; // when the table is in $ million, so figures are stored in dollars
  aggregate?: "monthlyAverage"; // for a daily table shown monthly: average the days in each month
};

export const RBA_SERIES: RbaSpec[] = [
  {
    id: "bond-2y", label: "2-year bond yield", unit: "%", frequency: "monthly", decimals: 2,
    note: "Yield on Australian Government 2-year bonds, average of daily figures in the month.",
    file: "f2-data.csv", seriesId: "FCMYGBAG2D", table: "Table F2", from: "2016-01-01", aggregate: "monthlyAverage",
  },
  {
    id: "bond-10y", label: "10-year bond yield", unit: "%", frequency: "monthly", decimals: 2,
    note: "Yield on Australian Government 10-year bonds, average of daily figures in the month. What the government pays to borrow for a decade.",
    file: "f2-data.csv", seriesId: "FCMYGBAG10D", table: "Table F2", from: "2016-01-01", aggregate: "monthlyAverage",
  },
  {
    id: "credit-card-debt", label: "Credit card debt", unit: "AUD", frequency: "monthly",
    note: "Credit and charge card balances accruing interest, all personal and commercial cards, seasonally adjusted. Balances paid off in full each month are not included.",
    file: "c1-data.csv", seriesId: "CCCCSBAISA", table: "Table C1", from: "2016-01-01", multiply: 1_000_000,
  },
  {
    // The daily table is the one to show: a Board decision is in it the next business morning. The
    // monthly table below is a month average published on the 1st, so a change late in a month does
    // not appear in it until the following month, and then diluted.
    id: "cash-rate-target", label: "Cash rate", unit: "%", frequency: "daily", decimals: 2,
    note: "RBA cash rate target, the rate set by the Board, on the day. The RBA posts each day's figure the next business morning, a new decision is added from the RBA's decisions page from the day it takes effect.",
    file: "f1-data.csv", seriesId: "FIRMMCRTD", table: "Table F1", from: "2016-01-01",
  },
  {
    id: "cash-rate", label: "Cash rate, monthly average", unit: "%", frequency: "monthly", decimals: 2,
    note: "RBA cash rate target averaged over the month, from the monthly table published on the first of the next month. Kept as history; the daily target is the figure shown.",
    file: "f1.1-data.csv", seriesId: "FIRMMCRT", table: "Table F1.1", from: "2016-01-01",
  },
  {
    id: "aud-usd", label: "Australian dollar", unit: "USD", frequency: "daily", decimals: 4,
    note: "US dollars per Australian dollar, 4pm Sydney indicative rate.",
    file: "f11.1-data.csv", seriesId: "FXRUSD", table: "Table F11.1", from: "2023-01-01",
  },
  // Added for the government scorecard (lib/scorecard.ts).
  {
    id: "mortgage-rate", label: "New mortgage rate", unit: "%", frequency: "monthly", decimals: 2,
    note: "Average interest rate on variable-rate owner-occupier housing loans funded in the month, all lenders: what a new borrower pays. The table starts in 2019.",
    file: "f6-data.csv", seriesId: "FLRHOFVA", table: "Table F6", from: "2019-01-01",
  },
  {
    id: "household-debt-income", label: "Household debt to income", unit: "%", frequency: "quarterly",
    note: "Household debt as a share of annualised household disposable income.",
    file: "e2-data.csv", seriesId: "BHFDDIT", table: "Table E2", from: "2016-01-01",
  },
];

// 2026-06-30 -> 2026-Q2, for tables dated at quarter end.
const quarter = (d: string) => `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// RBA tables use either 30/06/1969 or 03-Jan-2023.
function isoDate(raw: string): string | null {
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// The RBA's decisions page lists every Board decision with its effective date the afternoon it is
// announced, a business day or two before the daily table carries the new figure. It is read only to
// carry the daily target series forward to today; the CSV table stays the record.
// https://www.rba.gov.au/statistics/cash-rate/
export const CASH_RATE_DECISIONS_URL = "https://www.rba.gov.au/statistics/cash-rate/";

export type CashRateDecision = { effective: string; change: number; target: number };

export async function fetchCashRateDecisions(): Promise<CashRateDecision[]> {
  const res = await fetch(CASH_RATE_DECISIONS_URL, {
    headers: { "User-Agent": "receipts-dashboard (open-source economic dashboard)" },
    next: { revalidate: 3_600 },
  });
  if (!res.ok) throw new Error(`RBA returned ${res.status} for the cash rate decisions page`);
  const html = (await res.text()).replace(/\s+/g, " ");
  const out: CashRateDecision[] = [];
  // <th scope="row">30 Sep 2026</th> <td>+0.25</td> <td>4.60</td>
  const row = /<th scope="row">\s*(\d{1,2}) ([A-Za-z]{3}) (\d{4})\s*<\/th>\s*<td>\s*([+-]?\d+\.\d+)\s*<\/td>\s*<td>\s*(\d+\.\d+)\s*<\/td>/g;
  for (const m of html.matchAll(row)) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month < 0) continue;
    out.push({
      effective: `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`,
      change: Number(m[4]),
      target: Number(m[5]),
    });
  }
  if (out.length === 0) throw new Error("No decisions found on the RBA cash rate page");
  return out.sort((a, b) => (a.effective < b.effective ? -1 : 1));
}

const todayInSydney = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

// Add any decision already in effect that the daily table has not reached yet. The page failing
// changes nothing: the series is then just the table.
async function extendWithDecisions(points: Point[]): Promise<Point[]> {
  try {
    const last = points[points.length - 1].period;
    const today = todayInSydney();
    const newer = (await fetchCashRateDecisions()).filter((d) => d.effective > last && d.effective <= today);
    return [...points, ...newer.map((d) => ({ period: d.effective, value: d.target }))];
  } catch {
    return points;
  }
}

export async function fetchRba(spec: RbaSpec): Promise<Series> {
  const url = `https://www.rba.gov.au/statistics/tables/csv/${spec.file}`;
  const res = await fetch(url, {
    // The RBA site rejects requests that send no user agent at all.
    headers: { "User-Agent": "receipts-dashboard (open-source economic dashboard)" },
    next: { revalidate: 3_600 }, // an hour: the daily tables land about 09:00 and the site is rebuilt several times a day
  });
  if (!res.ok) throw new Error(`RBA returned ${res.status} for ${spec.file}`);

  const rows = (await res.text()).split(/\r?\n/).map((l) => l.split(","));
  const ids = rows.find((r) => r[0] === "Series ID");
  const col = ids ? ids.indexOf(spec.seriesId) : -1;
  if (col < 0) throw new Error(`Series ${spec.seriesId} not found in RBA ${spec.file}`);

  const daily: Point[] = [];
  for (const r of rows) {
    const date = isoDate(r[0] ?? "");
    const value = Number(r[col]) * (spec.multiply ?? 1);
    if (!date || date < spec.from || !r[col] || !Number.isFinite(value)) continue;
    daily.push({ period: date, value });
  }
  let points: Point[];
  if (spec.aggregate === "monthlyAverage") {
    const months = new Map<string, number[]>();
    for (const p of daily) months.set(p.period.slice(0, 7), [...(months.get(p.period.slice(0, 7)) ?? []), p.value]);
    points = [...months].map(([period, vs]) => ({ period, value: vs.reduce((a, b) => a + b, 0) / vs.length }));
  } else {
    points = daily.map((p) => ({
      period: spec.frequency === "monthly" ? p.period.slice(0, 7) : spec.frequency === "quarterly" ? quarter(p.period) : p.period,
      value: p.value,
    }));
  }
  if (points.length === 0) throw new Error(`RBA returned no observations for ${spec.id}`);
  if (spec.id === "cash-rate-target") points = await extendWithDecisions(points);

  const { file, seriesId, table, from, multiply, aggregate, ...rest } = spec;
  return { ...rest, points, source: `RBA, ${table}`, sourceUrl: url };
}
