// Commonwealth receipts from Budget Paper No. 1, Statement 5 (Revenue), which
// Treasury publishes as CSV tables alongside each Budget. budget.gov.au always
// serves the current Budget, so these URLs roll forward on their own.
// https://budget.gov.au/content/bp1/index.htm
import { USER_AGENT } from "../xlsx";

const BASE = "https://budget.gov.au/content/bp1/download";
export const RECEIPTS_URL = `${BASE}/bp1_s5-online_t1.csv`; // cash receipts by type, $m
export const SHARE_URL = `${BASE}/bp1_s5-online_t2.csv`; // cash receipts by type, % of GDP

export type YearValue = { year: string; value: number; estimate: boolean }; // year: 2024-25

export type RevenueLine = {
  name: string;
  group: "Income tax" | "Indirect tax" | "Non-tax";
  series: YearValue[]; // $m
  parts?: { name: string; series: YearValue[] }[];
};

export type Revenue = {
  latestActual: string; // last financial year with final figures
  total: YearValue[]; // total receipts, $m
  tax: YearValue[]; // taxation receipts, $m
  shareOfGdp: YearValue[]; // total receipts, % of GDP, back to 1978-79
  lines: RevenueLine[]; // largest first in the latest actual year; they add up to the total
};

// Row labels in table 1. The named lines plus "other" rows add up to total
// receipts exactly, so nothing is counted twice or dropped.
const LINES: { row: string; name: string; group: RevenueLine["group"]; parts?: [string, string][] }[] = [
  {
    row: "Total individuals and other withholding", name: "Individuals income tax", group: "Income tax",
    parts: [
      ["Gross income tax withholding", "Withheld from wages and salaries"],
      ["Gross other individuals and trusts", "Other individuals and trusts"],
      ["less: Refunds", "Less refunds"],
    ],
  },
  { row: "Company tax", name: "Company tax", group: "Income tax" },
  { row: "Superannuation fund taxes", name: "Superannuation fund taxes", group: "Income tax" },
  { row: "Fringe benefits tax", name: "Fringe benefits tax", group: "Income tax" },
  { row: "Resource rent taxes", name: "Resource rent taxes", group: "Income tax" },
  { row: "Goods and services tax", name: "GST", group: "Indirect tax" },
  {
    row: "Total excise duty", name: "Excise duty", group: "Indirect tax",
    parts: [["Fuel excise", "Fuel"], ["Other excise", "Alcohol, tobacco and other"]],
  },
  { row: "Customs duty", name: "Customs duty", group: "Indirect tax" },
  { row: "Wine equalisation tax", name: "Wine equalisation tax", group: "Indirect tax" },
  { row: "Luxury car tax", name: "Luxury car tax", group: "Indirect tax" },
  { row: "Other sales taxes", name: "Other sales taxes", group: "Indirect tax" },
  { row: "Carbon pricing mechanism", name: "Carbon pricing mechanism", group: "Indirect tax" },
  { row: "Major bank levy", name: "Major bank levy", group: "Indirect tax" },
  { row: "Agricultural levies", name: "Agricultural levies", group: "Indirect tax" },
  { row: "Other taxes", name: "Other taxes", group: "Indirect tax" },
  { row: "Interest", name: "Interest", group: "Non-tax" },
  { row: "Dividends and other", name: "Dividends and other non-tax receipts", group: "Non-tax" },
];

async function csv(url: string): Promise<string[][]> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`budget.gov.au returned ${res.status} for ${url}`);
  return (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
}

// "2025-26 (est) ($m)" -> { year: "2025-26", estimate: true }
function parseYear(label: string) {
  const year = label.match(/\d{4}-\d{2}/)?.[0];
  return year ? { year, estimate: /\(est\)/i.test(label) } : null;
}

export async function getRevenue(): Promise<Revenue> {
  const [receipts, share] = await Promise.all([csv(RECEIPTS_URL), csv(SHARE_URL)]);

  // Table 1: one row per head of revenue, one column per year.
  const years = receipts[0].map(parseYear);
  const rowFor = (label: string): YearValue[] => {
    const r = receipts.find((row) => row[0].toLowerCase() === label.toLowerCase());
    if (!r) return [];
    return years.flatMap((y, i) => (y && r[i] !== "" && Number.isFinite(Number(r[i])) ? [{ ...y, value: Number(r[i]) }] : []));
  };
  const total = rowFor("Total receipts");
  if (total.length === 0) throw new Error("Budget Paper 1 receipts table has no Total receipts row; the layout may have changed");
  const latestActual = [...total].reverse().find((t) => !t.estimate)!.year;
  const at = (s: YearValue[]) => s.find((p) => p.year === latestActual)?.value ?? 0;

  const lines = LINES.map((l) => ({
    name: l.name, group: l.group, series: rowFor(l.row),
    parts: l.parts?.map(([row, name]) => ({ name, series: rowFor(row) })),
  })).filter((l) => l.series.some((p) => p.value !== 0))
    .sort((a, b) => at(b.series) - at(a.series));

  // Table 2: one row per year, one column per head of revenue.
  const col = share[0].findIndex((h) => /^Total receipts/i.test(h));
  const shareOfGdp = share.slice(1).flatMap((r) => {
    const y = parseYear(r[0]);
    return y && col >= 0 && Number.isFinite(Number(r[col])) ? [{ ...y, value: Number(r[col]) }] : [];
  });

  return { latestActual, total, tax: rowFor("Taxation receipts"), shareOfGdp, lines };
}

export async function tryGetRevenue(): Promise<{ data: Revenue | null; error: string | null }> {
  try {
    return { data: await getRevenue(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
