// Migration statistics from the Department of Home Affairs and the ABS.
//
// Home Affairs publishes pivot-table exports on data.gov.au (CC BY 3.0 AU):
//   BP0019  temporary visa holders in Australia, by category, at each snapshot date
//   BP0014  temporary skilled visas granted, by applicant type and state, per year
//   BP0017  working holiday maker visas granted, by subclass and visa type, per year
//   BP0068  permanent Migration Program outcomes, by program and category, per year
// plus the Australian Migration Statistics package, one workbook a year with
// the long history: Migration Program outcomes since 1984-85, temporary visas
// granted since 2001-02, net overseas migration by visa category, and
// citizenship conferrals by country.
// Net overseas migration itself comes from the ABS Data API (CC BY 4.0).
//
// Every file is found through the data.gov.au catalogue, because Home Affairs
// replaces each file in place with a new name every release. The pivot exports
// only carry the dimensions shown in the sheet; country, age, gender and
// occupation are collapsed to "(All)" and are not available. Counts of 1 to 4
// are published as "<5" and are treated as missing.
import { unstable_cache } from "next/cache";
import { readWorkbook, excelDate, USER_AGENT, type Row, type Workbook } from "../xlsx";
import { fetchAbs } from "./abs";
import type { Series, Point } from "./types";

const CKAN = "https://data.gov.au/data/api/3/action";
const headers = { "User-Agent": USER_AGENT };

export type Release = { name: string; url: string; datasetUrl: string; modified: string }; // modified: YYYY-MM-DD

export type CategoryCount = { name: string; count: number | null; previous: number | null };

export type TempHolders = {
  release: Release;
  dates: string[]; // snapshot dates, oldest first, YYYY-MM-DD
  categories: { name: string; counts: (number | null)[] }[]; // one count per date
  latest: { date: string; total: number; previousDate: string | null; previousTotal: number | null; byCategory: CategoryCount[] };
  series: Series; // total holders at each snapshot
};

export type YearColumn = { label: string; year: string; partial: boolean }; // partial: "2025-26 to 31 March 2026"

export type Grants = {
  release: Release;
  years: YearColumn[];
  rows: { group: string; item: string; counts: (number | null)[] }[]; // group: applicant type or subclass; item: state or visa type
  totals: (number | null)[]; // Grand Total per year
  latest: { year: YearColumn; total: number; byGroup: CategoryCount[]; byItem: { group: string; item: string; count: number | null }[] };
  series: Series; // Grand Total per complete year
};

export type Outcomes = {
  release: Release;
  years: string[];
  rows: { program: string; category: string; counts: (number | null)[] }[];
  totals: (number | null)[];
  latest: { year: string; total: number; byCategory: CategoryCount[] };
  series: Series;
};

export type NomCategory = { name: string; arrivals: number; departures: number; net: number }; // persons

export type Package = {
  release: Release;
  program: { years: string[]; streams: { name: string; counts: number[] }[]; totals: number[]; series: Series }; // table 1.0
  tempGranted: { years: string[]; categories: { name: string; counts: number[] }[]; totals: number[]; series: Series }; // table 2.0
  nomByCategory: { year: string; categories: NomCategory[]; temporaryTotal: NomCategory | null; permanentTotal: NomCategory | null }; // tables 5.0, 5.1
  citizenship: { year: string; countries: { name: string; count: number }[]; other: number | null; total: number | null }; // table 6.0
};

export type Nom = { series: Series; arrivals: Series; departures: Series; latest: { year: string; nom: number; arrivals: number; departures: number; previousNom: number | null } };

export type Part<T> = { data: T | null; error: string | null };
export type Migration = { tempHolders: Part<TempHolders>; skilled: Part<Grants>; whm: Part<Grants>; permanent: Part<Outcomes>; package: Part<Package>; nom: Part<Nom> };

// --- spreadsheet helpers -------------------------------------------------

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const cells = (r: Row): [string, string][] => Object.entries(r).sort((a, b) => colNum(a[0]) - colNum(b[0]));
const findRow = (rows: Row[], col: string, test: RegExp, from = 0) => rows.findIndex((r, i) => i >= from && test.test((r[col] ?? "").trim()));
const isTotal = (s: string | undefined) => /\btotal\b/i.test(s ?? "");
const dash = (s: string) => s.replace(/[–—]/g, "-").trim(); // en dash in "1984–85"

// A published count. "<5" is suppression, anything else non-numeric is missing.
function count(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

function compare(now: (number | null)[], before: (number | null)[] | null, names: string[]): CategoryCount[] {
  return names.map((name, i) => ({ name, count: now[i], previous: before ? before[i] : null }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

// --- data.gov.au ----------------------------------------------------------

async function findResource(datasetId: string, name: RegExp): Promise<Release> {
  const res = await fetch(`${CKAN}/package_show?id=${datasetId}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} for dataset ${datasetId}`);
  const pkg = (await res.json()).result;
  const matches = (pkg.resources as any[])
    .filter((r) => /xlsx?/i.test(r.format ?? "") && name.test(r.name ?? ""))
    .sort((a, b) => String(b.last_modified ?? b.created).localeCompare(String(a.last_modified ?? a.created)));
  if (!matches.length) throw new Error(`No file matching ${name.source} in data.gov.au dataset "${pkg.title}"`);
  const r = matches[0];
  return { name: r.name.trim(), url: r.url, datasetUrl: `https://data.gov.au/data/dataset/${pkg.name}`, modified: String(r.last_modified ?? r.created).slice(0, 10) };
}

async function download(release: Release): Promise<Workbook> {
  const res = await fetch(release.url, { headers, cache: "no-store" }); // too big for the fetch cache; the result is cached instead
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} for ${release.name}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}

const fy = (label: string) => `FY${dash(label).slice(0, 7)}`; // "2024-25 to 31 March 2025" -> FY2024-25

function yearSeries(id: string, label: string, note: string, source: string, sourceUrl: string, years: string[], values: (number | null)[]): Series {
  const points: Point[] = years.flatMap((y, i) => (values[i] === null ? [] : [{ period: fy(y), value: values[i]! }]));
  return { id, label, unit: "people", frequency: "yearly", decimals: 0, note, source, sourceUrl, points };
}

// --- BP0019 temporary visa holders -----------------------------------------

async function loadTempHolders(): Promise<TempHolders> {
  const release = await findResource("ab245863-4dea-4661-a334-71ee15937130", /^BP0019.*temporary visa holders/i);
  const rows = (await download(release)).sheet("Visa Holders");
  const h = findRow(rows, "A", /^Visa Category$/i);
  if (h < 0) throw new Error(`${release.name}: no "Visa Category" header row; the layout may have changed`);

  const dateCols = cells(rows[h]).slice(1).map(([col, v]) => ({ col, date: excelDate(v)?.slice(0, 10) ?? null }))
    .filter((c): c is { col: string; date: string } => c.date !== null);
  const dates = dateCols.map((c) => c.date);
  const categories: TempHolders["categories"] = [];
  let totals: (number | null)[] | null = null;
  for (const r of rows.slice(h + 1)) {
    const name = (r.A ?? "").trim();
    if (!name) continue;
    const counts = dateCols.map((c) => count(r[c.col]));
    if (/^Grand Total$/i.test(name)) { totals = counts; break; }
    if (isTotal(name)) continue;
    categories.push({ name, counts });
  }
  if (!totals || !dates.length) throw new Error(`${release.name}: no Grand Total row or no snapshot dates`);

  const i = dates.length - 1;
  const source = "Department of Home Affairs, BP0019 Temporary visa holders in Australia";
  return {
    release, dates, categories,
    latest: {
      date: dates[i], total: totals[i] ?? sum(categories.map((c) => c.counts[i])),
      previousDate: i > 0 ? dates[i - 1] : null, previousTotal: i > 0 ? totals[i - 1] : null,
      byCategory: compare(categories.map((c) => c.counts[i]), i > 0 ? categories.map((c) => c.counts[i - 1]) : null, categories.map((c) => c.name)),
    },
    series: {
      id: "temp-visa-holders", label: "Temporary visa holders in Australia", unit: "people", frequency: "monthly", decimals: 2,
      note: "People in Australia on a temporary visa at each snapshot date, all categories. Excludes Bridging Visa E holders.",
      source, sourceUrl: release.datasetUrl,
      points: dates.flatMap((d, k) => (totals![k] === null ? [] : [{ period: d, value: totals![k]! }])),
    },
  };
}

// --- BP0014 skilled and BP0017 working holiday grants ---------------------
// Both sheets have the same shape: a group in column A that is only written on
// its first row, an item in column B, then one column per financial year,
// with subtotal rows per group and a Grand Total.

function parseGrants(rows: Row[], headerA: RegExp, release: Release, id: string, label: string, note: string, source: string): Grants {
  const h = findRow(rows, "A", headerA);
  if (h < 0) throw new Error(`${release.name}: no "${headerA.source}" header row; the layout may have changed`);
  const yearCols = cells(rows[h]).filter(([col, v]) => colNum(col) >= 3 && /^\d{4}[-–]\d{2}/.test(dash(v)))
    .map(([col, v]) => ({ col, label: dash(v), year: dash(v).slice(0, 7), partial: / to /i.test(v) && !/30 June/i.test(v) }));
  const years = yearCols.map(({ label, year, partial }) => ({ label, year, partial }));

  const out: Grants["rows"] = [];
  let totals: (number | null)[] | null = null;
  let group = "";
  for (const r of rows.slice(h + 1)) {
    const a = (r.A ?? "").trim(), b = (r.B ?? "").trim();
    const counts = yearCols.map((c) => count(r[c.col]));
    if (/^Grand Total$/i.test(a)) { totals = counts; break; }
    if (a) { if (isTotal(a)) { group = ""; continue; } group = a; }
    if (!group || !b || isTotal(b)) continue;
    out.push({ group, item: b, counts });
  }
  if (!totals || !years.length) throw new Error(`${release.name}: no Grand Total row or no year columns`);

  // The latest complete year is the headline; a year-to-date column is shown separately.
  const li = years.map((y) => y.partial).lastIndexOf(false);
  const groups = [...new Set(out.map((r) => r.group))];
  const byGroup = groups.map((g) => out.filter((r) => r.group === g));
  return {
    release, years, rows: out, totals,
    latest: {
      year: years[li], total: totals[li] ?? sum(out.map((r) => r.counts[li])),
      byGroup: compare(byGroup.map((rs) => sum(rs.map((r) => r.counts[li]))), li > 0 ? byGroup.map((rs) => sum(rs.map((r) => r.counts[li - 1]))) : null, groups),
      byItem: out.map((r) => ({ group: r.group, item: r.item, count: r.counts[li] })),
    },
    series: yearSeries(id, label, note, source, release.datasetUrl, years.filter((y) => !y.partial).map((y) => y.year), totals.filter((_, i) => !years[i].partial)),
  };
}

async function loadSkilled(): Promise<Grants> {
  const release = await findResource("2515b21d-0dba-4810-afd4-ac8dd92e873e", /^BP0014.*visas granted/i);
  return parseGrants((await download(release)).sheet("Granted"), /^Applicant Type$/i, release,
    "skilled-visas-granted", "Temporary skilled visas granted",
    "Temporary Work (Skilled) visas granted in each financial year, primary and secondary applicants together. Subclasses 457, 482 and 494 and their predecessors.",
    "Department of Home Affairs, BP0014 Temporary Resident (skilled) visas granted");
}

async function loadWhm(): Promise<Grants> {
  const release = await findResource("602f74a0-a588-4dea-ae28-0fe123cbb182", /^BP0017.*visas granted/i);
  return parseGrants((await download(release)).sheet("Visa Granted"), /^Visa Subclass$/i, release,
    "whm-visas-granted", "Working holiday visas granted",
    "Working Holiday (417) and Work and Holiday (462) visas granted in each financial year, first, second and third visas together.",
    "Department of Home Affairs, BP0017 Working Holiday Maker visas granted");
}

// --- BP0068 permanent Migration Program outcomes ----------------------------
// Same shape as the grants sheets, shifted one column right, with a Grand Total column to ignore.

async function loadPermanent(): Promise<Outcomes> {
  const release = await findResource("096fd157-807c-4ba0-8c63-0754cae4ba35", /^BP0068.*Outcome/i);
  const rows = (await download(release)).sheet("Outcome");
  const h = findRow(rows, "B", /^Visa Program$/i);
  if (h < 0) throw new Error(`${release.name}: no "Visa Program" header row; the layout may have changed`);
  const yearCols = cells(rows[h]).filter(([col, v]) => colNum(col) >= 4 && /^\d{4}[-–]\d{2}$/.test(dash(v))).map(([col, v]) => ({ col, year: dash(v) }));
  const years = yearCols.map((c) => c.year);

  const out: Outcomes["rows"] = [];
  let totals: (number | null)[] | null = null;
  let program = "";
  for (const r of rows.slice(h + 1)) {
    const b = (r.B ?? "").trim(), c = (r.C ?? "").trim();
    const counts = yearCols.map((col) => count(r[col.col]));
    if (/^Grand Total$/i.test(b)) { totals = counts; break; }
    if (b) { if (isTotal(b)) { program = ""; continue; } program = b; }
    if (!program || !c || isTotal(c)) continue;
    out.push({ program, category: c, counts });
  }
  if (!totals || !years.length) throw new Error(`${release.name}: no Grand Total row or no year columns`);

  const li = years.length - 1;
  const cats = [...new Set(out.map((r) => r.category))];
  const byCat = (i: number) => cats.map((c) => sum(out.filter((r) => r.category === c).map((r) => r.counts[i])));
  const source = "Department of Home Affairs, BP0068 Permanent Migration Program outcomes";
  return {
    release, years, rows: out, totals,
    latest: { year: years[li], total: totals[li] ?? sum(byCat(li)), byCategory: compare(byCat(li), li > 0 ? byCat(li - 1) : null, cats) },
    series: yearSeries("migration-program-outcomes", "Permanent Migration Program outcomes",
      "Places delivered under the permanent Migration Program (skilled, family, special eligibility) and the Child Program in each programme year, July to June. Not a count of people in Australia. Before 2017-18 the figures exclude New Zealand citizens.",
      source, release.datasetUrl, years, totals),
  };
}

// --- Australian Migration Statistics package -------------------------------

function yearTable(wb: Workbook, sheet: string, release: Release) {
  const rows = wb.sheet(sheet);
  const h = findRow(rows, "B", /^Year$/i);
  if (h < 0) throw new Error(`${release.name}: table ${sheet} has no "Year" header row`);
  const cols = cells(rows[h]).slice(1).map(([col, v]) => ({ col, name: dash(v).replace(/\d+$/, "").trim() })); // "Family stream1" carries a footnote number
  const data = rows.slice(h + 1).map((r) => ({ year: dash(r.B ?? ""), values: cols.map((c) => count(r[c.col])) }))
    .filter((r) => /^\d{4}(-\d{2})?$/.test(r.year));
  return { cols, data };
}

async function loadPackage(): Promise<Package> {
  const release = await findResource("australian-migration-statistics", /^Australian Migration Statistics, \d{4}/i);
  const wb = await download(release);
  const source = "Department of Home Affairs, Australian Migration Statistics";
  const year = release.name.match(/(\d{4})[-–](\d{2})/)?.slice(1).join("-") ?? "";

  // Tables 1.0 and 2.0: one column per stream or category and a Total column.
  const split = (t: ReturnType<typeof yearTable>) => {
    const ti = t.cols.findIndex((c) => isTotal(c.name));
    if (ti < 0) throw new Error(`${release.name}: table has no Total column`);
    return {
      parts: t.cols.flatMap((c, i) => (i === ti ? [] : [{ name: c.name, counts: t.data.map((r) => r.values[i] ?? 0) }])),
      totals: t.data.map((r) => r.values[ti] ?? 0),
    };
  };
  const t1 = yearTable(wb, "1.0", release), s1 = split(t1);
  const streams = s1.parts, programTotals = s1.totals;
  const t2 = yearTable(wb, "2.0", release), s2 = split(t2);
  const categories = s2.parts, tempTotals = s2.totals;

  // Tables 5.0 and 5.1: arrivals and departures in thousands, by visa category, calendar years.
  const arr = yearTable(wb, "5.0", release), dep = yearTable(wb, "5.1", release);
  const last = arr.data[arr.data.length - 1], lastDep = dep.data.find((r) => r.year === last.year);
  if (!lastDep) throw new Error(`${release.name}: table 5.1 has no row for ${last.year}`);
  const cat = (i: number): NomCategory => ({
    name: arr.cols[i].name, arrivals: Math.round((last.values[i] ?? 0) * 1000), departures: Math.round((lastDep.values[i] ?? 0) * 1000),
    net: Math.round(((last.values[i] ?? 0) - (lastDep.values[i] ?? 0)) * 1000),
  });
  const all = arr.cols.map((_, i) => cat(i));
  const totalIdx = arr.cols.map((c, i) => (isTotal(c.name) ? i : -1)).filter((i) => i >= 0);

  const c6 = wb.sheet("6.0");
  const gh = findRow(c6, "B", /^Gender$/i);
  const totalRow = c6.find((r, i) => i > gh && /^Total/i.test(r.B ?? ""));
  if (gh < 0 || !totalRow) throw new Error(`${release.name}: table 6.0 has no Gender header or Total row`);
  // Columns are the top countries, then "Other countries" and "Total" (with footnote digits on the names).
  const c6cols = cells(c6[gh]).slice(1).map(([col, name]) => ({ name: name.trim().replace(/\d+$/, ""), count: count(totalRow[col]) }));
  const countries = c6cols.filter((c) => !/^(other countries|total)$/i.test(c.name) && (c.count ?? 0) > 0).map((c) => ({ name: c.name, count: c.count! }));
  const cYear = dash(c6[0]?.B ?? "").match(/\d{4}-\d{2}/)?.[0] ?? year;

  return {
    release,
    program: {
      years: t1.data.map((r) => r.year), streams, totals: programTotals,
      series: yearSeries("migration-program-history", "Migration Program outcome since 1984-85",
        "Permanent Migration Program outcome by programme year: skill, family, child and special eligibility streams. Humanitarian visas are a separate program and are not included.",
        source, release.datasetUrl, t1.data.map((r) => r.year), programTotals),
    },
    tempGranted: {
      years: t2.data.map((r) => r.year), categories, totals: tempTotals,
      series: yearSeries("temp-visas-granted", "Temporary visas granted",
        "Temporary visas granted in each financial year, every category including visitors, students and New Zealand citizens' Special Category visas. A grant is not an arrival: many visitor visas are never used.",
        source, release.datasetUrl, t2.data.map((r) => r.year), tempTotals),
    },
    nomByCategory: {
      year: last.year,
      categories: all.filter((_, i) => !totalIdx.includes(i)),
      temporaryTotal: totalIdx[0] !== undefined ? all[totalIdx[0]] : null,
      permanentTotal: totalIdx[1] !== undefined ? all[totalIdx[1]] : null,
    },
    citizenship: {
      year: cYear, countries,
      other: c6cols.find((c) => /^other countries$/i.test(c.name))?.count ?? null,
      total: c6cols.find((c) => /^total$/i.test(c.name))?.count ?? null,
    },
  };
}

// --- ABS net overseas migration -------------------------------------------

async function loadNom(): Promise<Nom> {
  const common = { unit: "people" as const, frequency: "yearly" as const, decimals: 0, flow: "ABS,NOM_FY,1.0.0", from: "2004", table: "Overseas Migration" };
  // Measure 1 arrivals, 2 departures, 3 net; TOT all ages; 3 persons; AUS; annual. Periods are the year ending 30 June.
  const toFy = (s: Series): Series => ({ ...s, points: s.points.map((p) => ({ ...p, period: `FY${Number(p.period) - 1}-${p.period.slice(2)}` })) });
  const [series, arrivals, departures] = await Promise.all([
    fetchAbs({ ...common, id: "net-overseas-migration", label: "Net overseas migration", key: "3.TOT.3.AUS.A",
      note: "Net overseas migration for the year ending 30 June: long-term arrivals (staying 12 of 16 months) minus long-term departures. The latest year is preliminary and is revised." }),
    fetchAbs({ ...common, id: "nom-arrivals", label: "Overseas migration arrivals", key: "1.TOT.3.AUS.A", note: "Long-term arrivals counted in net overseas migration, year ending 30 June." }),
    fetchAbs({ ...common, id: "nom-departures", label: "Overseas migration departures", key: "2.TOT.3.AUS.A", note: "Long-term departures counted in net overseas migration, year ending 30 June." }),
  ].map((p) => p.then(toFy)));
  const n = series.points.length - 1;
  const at = (s: Series, period: string) => s.points.find((p) => p.period === period)?.value ?? 0;
  const year = series.points[n].period;
  return {
    series, arrivals, departures,
    latest: { year, nom: series.points[n].value, arrivals: at(arrivals, year), departures: at(departures, year), previousNom: n > 0 ? series.points[n - 1].value : null },
  };
}

// --- public ---------------------------------------------------------------

// Each file is a separate download (the skilled visas one is 20 MB), so each is cached on its own.
const DAY = 86_400;
const cached = {
  tempHolders: unstable_cache(loadTempHolders, ["migration-temp-holders-v1"], { revalidate: DAY }),
  skilled: unstable_cache(loadSkilled, ["migration-skilled-v1"], { revalidate: DAY }),
  whm: unstable_cache(loadWhm, ["migration-whm-v1"], { revalidate: DAY }),
  permanent: unstable_cache(loadPermanent, ["migration-permanent-v1"], { revalidate: DAY }),
  package: unstable_cache(loadPackage, ["migration-package-v1"], { revalidate: DAY }),
  nom: unstable_cache(loadNom, ["migration-nom-v1"], { revalidate: 21_600 }),
};

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try { return { data: await load(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}

// One dead file never blanks the page: every part carries its own error.
export async function tryGetMigration(): Promise<Migration> {
  const [tempHolders, skilled, whm, permanent, pkg, nom] = await Promise.all([
    part(cached.tempHolders), part(cached.skilled), part(cached.whm), part(cached.permanent), part(cached.package), part(cached.nom),
  ]);
  return { tempHolders, skilled, whm, permanent, package: pkg, nom };
}
