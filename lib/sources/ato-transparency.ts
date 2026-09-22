// The ATO's annual Corporate Tax Transparency report: every Australian public
// and foreign-owned company with total income of $100 million or more, and
// Australian private companies from $200 million, with the income, taxable
// income and tax payable each one reported. CC BY 3.0 AU.
// https://data.gov.au/data/dataset/corporate-transparency
import { unstable_cache } from "next/cache";
import { readWorkbook, USER_AGENT } from "../xlsx";

const DATASET = "https://data.gov.au/data/api/3/action/package_show?id=corporate-transparency";

export type Entity = { name: string; abn: string; incomeYear: string; income: number; taxable: number; tax: number };

export type YearTotals = { year: string; entities: number; income: number; taxable: number; tax: number; noTax: number };

export type Transparency = {
  year: string; // income year of the latest report, e.g. 2023-24
  datasetUrl: string;
  fileUrl: string;
  totals: YearTotals;
  previous: YearTotals | null; // the year before, for comparison
  noTaxIncome: number; // total income of the entities with no tax payable
  byIncome: Entity[]; // largest by total income
  byTax: Entity[]; // largest taxpayers
  noTaxByIncome: Entity[]; // largest by income among those with no tax payable
};

async function readYear(url: string): Promise<{ year: string; entities: Entity[]; late: Entity[] }> {
  // Not cache: "no-store": that would make the static build refuse to render. The
  // result is cached by unstable_cache below; the spreadsheet itself is too big for
  // Next's fetch cache, which just skips it with a warning.
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} for the ATO transparency file`);
  const book = readWorkbook(Buffer.from(await res.arrayBuffer()));
  const sheetName = book.sheetNames.find((n) => /income tax/i.test(n));
  if (!sheetName) throw new Error("ATO transparency workbook has no income tax sheet; the layout may have changed");
  const rows = book.sheet(sheetName);
  const headAt = rows.findIndex((r) => Object.values(r).some((v) => /^Total income/i.test(v)));
  if (headAt < 0) throw new Error("ATO transparency sheet has no Total income column; the layout may have changed");
  const col = (pattern: RegExp) => Object.entries(rows[headAt]).find(([, v]) => pattern.test(v.trim()))?.[0] ?? "";
  const c = { name: col(/^Name/i), abn: col(/^ABN/i), income: col(/^Total income/i), taxable: col(/^Taxable income/i), tax: col(/^Tax payable/i), year: col(/^Income year/i) };

  // A blank taxable income or tax payable cell means nil was reported.
  const all = rows.slice(headAt + 1).filter((r) => r[c.name] && r[c.income]).map((r) => ({
    name: r[c.name].trim(), abn: (r[c.abn] ?? "").trim(), incomeYear: (r[c.year] ?? "").trim(),
    income: Number(r[c.income]) || 0, taxable: Number(r[c.taxable]) || 0, tax: Number(r[c.tax]) || 0,
  }));

  // Each report also carries a few dozen late entries for earlier years, so the same company can appear
  // twice. The report's own year is the most common one; headline figures use only those rows.
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.incomeYear, (counts.get(e.incomeYear) ?? 0) + 1);
  const year = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { year, entities: all.filter((e) => e.incomeYear === year), late: all.filter((e) => e.incomeYear !== year) };
}

const totalsOf = (year: string, e: Entity[]): YearTotals => ({
  year, entities: e.length,
  income: e.reduce((s, x) => s + x.income, 0), taxable: e.reduce((s, x) => s + x.taxable, 0),
  tax: e.reduce((s, x) => s + x.tax, 0), noTax: e.filter((x) => x.tax <= 0).length,
});

// Every row in the latest report, late entries included, each tagged with its own income year.
// For storing in the database and joining to other sources by ABN.
export async function loadAllEntities(): Promise<{ year: string; entities: Entity[] }> {
  const files = await listFiles();
  const latest = await readYear(files[0].url);
  return { year: latest.year || files[0].name.slice(0, 7), entities: [...latest.entities, ...latest.late] };
}

async function listFiles(): Promise<{ name: string; url: string }[]> {
  const meta = await fetch(DATASET, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86_400 } });
  if (!meta.ok) throw new Error(`data.gov.au returned ${meta.status}`);
  // One spreadsheet per income year; the name starts with the year, so sorting by name puts the newest first.
  const files: { name: string; url: string }[] = ((await meta.json()).result?.resources ?? [])
    .filter((r: any) => /^\d{4}-\d{2}\s+Report of Entity Tax Information/i.test(r.name ?? "") && /xlsx/i.test(r.format ?? r.url))
    .map((r: any) => ({ name: r.name as string, url: r.url as string }))
    .sort((a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name));
  if (files.length === 0) throw new Error("No Report of Entity Tax Information files found in the ATO dataset");
  return files;
}

async function load(): Promise<Transparency> {
  const files = await listFiles();
  const [latest, before] = await Promise.all([readYear(files[0].url), files[1] ? readYear(files[1].url) : null]);
  const e = latest.entities;
  const noTax = e.filter((x) => x.tax <= 0);
  const top = (list: Entity[], by: (x: Entity) => number) => [...list].sort((a, b) => by(b) - by(a)).slice(0, 15);

  return {
    year: latest.year || files[0].name.slice(0, 7),
    datasetUrl: "https://data.gov.au/data/dataset/corporate-transparency",
    fileUrl: files[0].url,
    totals: totalsOf(latest.year, e),
    previous: before ? totalsOf(before.year || files[1].name.slice(0, 7), before.entities) : null,
    noTaxIncome: noTax.reduce((s, x) => s + x.income, 0),
    byIncome: top(e, (x) => x.income),
    byTax: top(e, (x) => x.tax),
    noTaxByIncome: top(noTax, (x) => x.income),
  };
}

// Published once a year, usually in October or November.
const cached = unstable_cache(load, ["ato-transparency-v2"], { revalidate: 86_400 });

export async function tryGetTransparency(): Promise<{ data: Transparency | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
