// Reserve Bank of Australia statistical tables (CSV, no key).
// Index of tables: https://www.rba.gov.au/statistics/tables/
import type { Point, Series } from "./types";

type RbaSpec = Omit<Series, "points" | "source" | "sourceUrl"> & {
  file: string; // csv file name under /statistics/tables/csv/
  seriesId: string; // value in the "Series ID" row
  table: string;
  from: string; // earliest period to keep, ISO date
};

export const RBA_SERIES: RbaSpec[] = [
  {
    id: "cash-rate", label: "Cash rate", unit: "%", frequency: "monthly", decimals: 2,
    note: "RBA cash rate target, monthly average.",
    file: "f1.1-data.csv", seriesId: "FIRMMCRT", table: "Table F1.1", from: "2016-01-01",
  },
  {
    id: "aud-usd", label: "Australian dollar", unit: "USD", frequency: "daily", decimals: 4,
    note: "US dollars per Australian dollar, 4pm Sydney indicative rate.",
    file: "f11.1-data.csv", seriesId: "FXRUSD", table: "Table F11.1", from: "2023-01-01",
  },
];

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

export async function fetchRba(spec: RbaSpec): Promise<Series> {
  const url = `https://www.rba.gov.au/statistics/tables/csv/${spec.file}`;
  const res = await fetch(url, {
    // The RBA site rejects requests that send no user agent at all.
    headers: { "User-Agent": "receipts-dashboard (open-source economic dashboard)" },
    next: { revalidate: 21_600 },
  });
  if (!res.ok) throw new Error(`RBA returned ${res.status} for ${spec.file}`);

  const rows = (await res.text()).split(/\r?\n/).map((l) => l.split(","));
  const ids = rows.find((r) => r[0] === "Series ID");
  const col = ids ? ids.indexOf(spec.seriesId) : -1;
  if (col < 0) throw new Error(`Series ${spec.seriesId} not found in RBA ${spec.file}`);

  const points: Point[] = [];
  for (const r of rows) {
    const date = isoDate(r[0] ?? "");
    const value = Number(r[col]);
    if (!date || date < spec.from || !r[col] || !Number.isFinite(value)) continue;
    points.push({ period: spec.frequency === "monthly" ? date.slice(0, 7) : date, value });
  }
  if (points.length === 0) throw new Error(`RBA returned no observations for ${spec.id}`);

  const { file, seriesId, table, from, ...rest } = spec;
  return { ...rest, points, source: `RBA, ${table}`, sourceUrl: url };
}
