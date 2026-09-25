// ABS Recorded Crime: Victims (calendar years) and Offenders (financial years).
// Neither is in the ABS Data API, so this reads the publication spreadsheets
// linked from each release page, which the ABS replaces once a year. The link
// text changes with the edition, so the files are found by their table numbers.
// Data: ABS, CC BY 4.0.
import { unstable_cache } from "next/cache";
import { readWorkbook, USER_AGENT, type Row, type Workbook } from "../xlsx";
import type { Series, Point } from "./types";

const ABS = "https://www.abs.gov.au";
const VICTIMS_PAGE = `${ABS}/statistics/people/crime-and-justice/recorded-crime-victims/latest-release`;
const OFFENDERS_PAGE = `${ABS}/statistics/people/crime-and-justice/recorded-crime-offenders/latest-release`;
const headers = { "User-Agent": USER_AGENT };

export type Part<T> = { data: T | null; error: string | null };

export const REGIONS: Record<string, string> = {
  Australia: "AUS", "New South Wales": "NSW", Victoria: "VIC", Queensland: "QLD", "South Australia": "SA",
  "Western Australia": "WA", Tasmania: "TAS", "Northern Territory": "NT", "Australian Capital Territory": "ACT",
  NSW: "NSW", "Vic.": "VIC", Qld: "QLD", SA: "SA", WA: "WA", "Tas.": "TAS", NT: "NT", ACT: "ACT",
};
export const REGION_NAMES: Record<string, string> = {
  AUS: "Australia", NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia",
  WA: "Western Australia", TAS: "Tasmania", NT: "Northern Territory", ACT: "Australian Capital Territory",
};
export const STATE_CODES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

// The top-level offences in the victims tables. Sub-rows (murder, armed robbery...) are left out.
export const VICTIM_OFFENCES: { name: string; slug: string }[] = [
  { name: "Homicide", slug: "homicide" },
  { name: "Assault", slug: "assault" },
  { name: "Sexual assault", slug: "sexual-assault" },
  { name: "Kidnapping/abduction", slug: "kidnapping" },
  { name: "Robbery", slug: "robbery" },
  { name: "Blackmail/other extortion", slug: "extortion" },
  { name: "Burglary", slug: "burglary" },
  { name: "Motor vehicle theft", slug: "motor-vehicle-theft" },
  { name: "Other theft", slug: "other-theft" },
];

// Offender principal offence divisions, by ANZSOC code.
export const OFFENDER_DIVISIONS: { code: string; name: string; slug: string }[] = [
  { code: "01", name: "Homicide and related offences", slug: "homicide" },
  { code: "02", name: "Acts intended to cause injury", slug: "injury" },
  { code: "03", name: "Sexual assault and related offences", slug: "sexual-assault" },
  { code: "04", name: "Dangerous or negligent acts", slug: "dangerous-acts" },
  { code: "05", name: "Abduction and harassment", slug: "abduction-harassment" },
  { code: "06", name: "Robbery and extortion", slug: "robbery-extortion" },
  { code: "07", name: "Unlawful entry with intent", slug: "unlawful-entry" },
  { code: "08", name: "Theft", slug: "theft" },
  { code: "09", name: "Fraud and deception", slug: "fraud" },
  { code: "10", name: "Illicit drug offences", slug: "drugs" },
  { code: "11", name: "Weapons and explosives", slug: "weapons" },
  { code: "12", name: "Property damage and environmental pollution", slug: "property-damage" },
  { code: "13", name: "Public order offences", slug: "public-order" },
  { code: "14", name: "Traffic and vehicle offences", slug: "traffic" },
  { code: "15", name: "Offences against justice procedures", slug: "justice-procedures" },
  { code: "16", name: "Miscellaneous offences", slug: "miscellaneous" },
];

export type VictimRow = { region: string; offence: string; slug: string; counts: (number | null)[]; rates: (number | null)[] };
export type Victims = {
  page: string;
  files: { national: string; states: string };
  edition: string; // "2025"
  years: string[]; // calendar years, oldest first
  rows: VictimRow[]; // every region and offence; AUS rates only where the ABS publishes them
  series: Series[];
};

export type OffenderRow = { region: string; code: string; name: string; slug: string; counts: (number | null)[]; rates: (number | null)[] };
export type Offenders = {
  page: string;
  files: { national: string; states: string };
  edition: string; // "2024–25"
  years: string[]; // FY2008-09 ... oldest first
  national: OffenderRow[]; // includes a "Total" row with code "TOT"
  states: OffenderRow[]; // the years the state table carries, usually the last five
  stateYears: string[];
  series: Series[];
};

// --- helpers ------------------------------------------------------------------

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const clean = (s: string | undefined) => (s ?? "").replace(/\([a-z]{1,2}\)/g, "").replace(/\s+/g, " ").trim(); // "Northern Territory(z)(aa)" -> "Northern Territory"
const num = (v: string | undefined): number | null => {
  const n = Number((v ?? "").trim());
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : null; // "np" (not published) becomes null
};
const fy = (label: string) => `FY${label.replace(/[–—]/g, "-").slice(0, 7)}`; // "2016–17(d)" -> FY2016-17

async function page(url: string): Promise<string> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`ABS returned ${res.status} for ${url}`);
  return res.text();
}

// The release page links each table file; pick the one whose name matches.
function fileLink(html: string, name: RegExp): string {
  const links = [...html.matchAll(/href="([^"]+\.xlsx)"/g)].map((m) => decodeURIComponent(m[1]));
  const hit = links.find((l) => name.test(l));
  if (!hit) throw new Error(`No spreadsheet matching ${name.source} on the ABS release page`);
  return hit.startsWith("http") ? hit : ABS + hit;
}

async function workbook(url: string): Promise<Workbook> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`ABS returned ${res.status} for ${url}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}

// A year-by-column table: a header row with a label in A and years across, then blocks
// introduced by a row that only has a label in column B (a measure, a state or a year).
type Block = { label: string; rows: { label: string; values: (number | null)[] }[] };
function yearTable(rows: Row[], headerTest: RegExp): { years: string[]; yearCols: string[]; blocks: Block[] } {
  const h = rows.findIndex((r) => headerTest.test((r.A ?? "").trim()));
  if (h < 0) throw new Error(`No header row matching ${headerTest.source}`);
  const yearCols = Object.keys(rows[h]).filter((c) => c !== "A" && /\d{4}/.test(rows[h][c])).sort((a, b) => colNum(a) - colNum(b));
  const years = yearCols.map((c) => rows[h][c]);
  const blocks: Block[] = [];
  for (const r of rows.slice(h + 1)) {
    const a = clean(r.A), b = clean(r.B);
    if (/^footnotes$/i.test(a)) break;
    if (!a && b && !yearCols.slice(1).some((c) => (r[c] ?? "").trim())) { blocks.push({ label: b, rows: [] }); continue; }
    if (!a || !blocks.length) continue;
    blocks[blocks.length - 1].rows.push({ label: a, values: yearCols.map((c) => num(r[c])) });
  }
  return { years, yearCols, blocks };
}

function series(id: string, label: string, unit: Series["unit"], decimals: number, note: string, source: string, sourceUrl: string, periods: string[], values: (number | null)[], frequency: Series["frequency"] = "yearly"): Series | null {
  const points: Point[] = periods.flatMap((p, i) => (values[i] === null ? [] : [{ period: p, value: values[i]! }]));
  return points.length ? { id, label, unit, frequency, decimals, note, source, sourceUrl, points } : null;
}

// --- victims ------------------------------------------------------------------

async function loadVictims(): Promise<Victims> {
  const html = await page(VICTIMS_PAGE);
  const files = { national: fileLink(html, /Tables 1 to 8/i), states: fileLink(html, /Tables 9 to 16/i) };
  const edition = files.national.match(/recorded-crime-victims\/(\d{4})\//)?.[1] ?? "latest";
  const [nat, st] = await Promise.all([workbook(files.national), workbook(files.states)]);

  const rows: VictimRow[] = [];
  const offence = (label: string) => VICTIM_OFFENCES.find((o) => o.name.toLowerCase() === label.toLowerCase());

  // Table 1: Australia. Blocks "Number" and "Victimisation rate".
  const t1 = yearTable(nat.sheet("Table 1"), /^Offence$/i);
  const years = t1.years.map((y) => y.slice(0, 4));
  const natCounts = t1.blocks.find((b) => /^number$/i.test(b.label)), natRates = t1.blocks.find((b) => /rate/i.test(b.label));
  if (!natCounts) throw new Error("Table 1 has no Number block");
  for (const o of VICTIM_OFFENCES) {
    const c = natCounts.rows.find((r) => offence(r.label)?.slug === o.slug);
    if (!c) continue;
    const r = natRates?.rows.find((r) => offence(r.label)?.slug === o.slug);
    rows.push({ region: "AUS", offence: o.name, slug: o.slug, counts: c.values, rates: r?.values ?? years.map(() => null) });
  }

  // Table 9 (numbers) and Table 10 (rates): one block per state.
  const t9 = yearTable(st.sheet("Table 9"), /^Offence$/i), t10 = yearTable(st.sheet("Table 10"), /^Offence$/i);
  if (t9.years.length !== t1.years.length) throw new Error(`Table 9 has ${t9.years.length} years, Table 1 has ${t1.years.length}`);
  for (const b of t9.blocks) {
    const region = REGIONS[b.label];
    if (!region) continue;
    const rateBlock = t10.blocks.find((x) => REGIONS[x.label] === region);
    for (const row of b.rows) {
      const o = offence(row.label);
      if (!o) continue;
      const rates = rateBlock?.rows.find((r) => offence(r.label)?.slug === o.slug)?.values ?? years.map(() => null);
      rows.push({ region, offence: o.name, slug: o.slug, counts: row.values, rates });
    }
  }

  const src = `ABS, Recorded Crime – Victims, ${edition}`;
  const out: Series[] = [];
  for (const r of rows) {
    const where = REGION_NAMES[r.region];
    const cnt = series(`crime:victims:${r.region}:${r.slug}`, `${r.offence} victims, ${where}`, "number", 0,
      `Victims of ${r.offence.toLowerCase()} recorded by police in the calendar year, ${where}. A victim is a person, or for property offences a household or organisation.`,
      src, r.region === "AUS" ? files.national : files.states, years, r.counts);
    const rate = series(`crime:victim-rate:${r.region}:${r.slug}`, `${r.offence} victims per 100,000 people, ${where}`, "ratio", 1,
      `Victims of ${r.offence.toLowerCase()} per 100,000 people, ${where}, as published by the ABS.`,
      src, r.region === "AUS" ? files.national : files.states, years, r.rates);
    if (cnt) out.push(cnt);
    if (rate) out.push(rate);
  }
  return { page: VICTIMS_PAGE, files, edition, years, rows, series: out };
}

// --- offenders ------------------------------------------------------------------

function division(label: string) {
  const code = label.trim().slice(0, 2);
  return /^\d{2}$/.test(code) && label.trim()[2] === " " ? OFFENDER_DIVISIONS.find((d) => d.code === code) : undefined;
}

async function loadOffenders(): Promise<Offenders> {
  const html = await page(OFFENDERS_PAGE);
  const files = { national: fileLink(html, /1\. Offenders, Australia/i), states: fileLink(html, /2\. Offenders, states/i) };
  const edition = files.national.match(/recorded-crime-offenders\/([\d–-]+)\//)?.[1]?.replace("-", "–") ?? "latest";
  const [nat, st] = await Promise.all([workbook(files.national), workbook(files.states)]);

  // Table 1: one header row with the years twice, numbers then rates. The "Offender rate" caption
  // in the row above marks where the rates start.
  const rows1 = nat.sheet("Table 1");
  const h = rows1.findIndex((r) => /^Principal offence/i.test((r.A ?? "").trim()));
  if (h < 0) throw new Error("Offenders Table 1 has no header row");
  const cap = rows1[h - 1] ?? {};
  const rateCol = Object.keys(cap).find((c) => /offender rate/i.test(cap[c] ?? ""));
  if (!rateCol) throw new Error("Offenders Table 1 has no Offender rate caption");
  const cols = Object.keys(rows1[h]).filter((c) => c !== "A" && /\d{4}/.test(rows1[h][c])).sort((a, b) => colNum(a) - colNum(b));
  const countCols = cols.filter((c) => colNum(c) < colNum(rateCol)), rateCols = cols.filter((c) => colNum(c) >= colNum(rateCol));
  const years = countCols.map((c) => fy(rows1[h][c]));
  if (rateCols.length !== years.length) throw new Error(`Offenders Table 1: ${countCols.length} count years but ${rateCols.length} rate years`);

  const national: OffenderRow[] = [];
  for (const r of rows1.slice(h + 1)) {
    const label = (r.A ?? "").trim();
    if (/^footnotes$/i.test(label)) break;
    const d = division(label);
    const total = /^total( offenders)?$/i.test(clean(label)); // "Total(p)"
    if (!d && !total) continue;
    national.push({
      region: "AUS", code: d?.code ?? "TOT", name: d?.name ?? "All offenders", slug: d?.slug ?? "total",
      counts: countCols.map((c) => num(r[c])), rates: rateCols.map((c) => num(r[c])),
    });
  }
  if (!national.length) throw new Error("Offenders Table 1 has no division rows");

  // Table 6: header row with state abbreviations twice (numbers, rates), then a block per year.
  const rows6 = st.sheet("Table 6");
  const h6 = rows6.findIndex((r) => /^Principal offence/i.test((r.A ?? "").trim()));
  if (h6 < 0) throw new Error("Offenders Table 6 has no header row");
  const cap6 = rows6[h6 - 1] ?? {};
  const rate6 = Object.keys(cap6).find((c) => /offender rate/i.test(cap6[c] ?? ""));
  if (!rate6) throw new Error("Offenders Table 6 has no Offender rate caption");
  const regionCols = Object.keys(rows6[h6]).filter((c) => c !== "A" && REGIONS[clean(rows6[h6][c])]).sort((a, b) => colNum(a) - colNum(b));
  const countRegionCols = regionCols.filter((c) => colNum(c) < colNum(rate6)), rateRegionCols = regionCols.filter((c) => colNum(c) >= colNum(rate6));
  const stateYears: string[] = [];
  const byKey = new Map<string, OffenderRow>();
  let year: string | null = null;
  for (const r of rows6.slice(h6 + 1)) {
    const a = (r.A ?? "").trim(), b = (r.B ?? "").trim();
    if (/^footnotes$/i.test(a)) break;
    if (!a && /^\d{4}[–-]\d{2}/.test(b)) { year = fy(b); stateYears.push(year); continue; }
    const d = division(a), total = /^total( offenders)?$/i.test(clean(a));
    if (!year || (!d && !total)) continue;
    countRegionCols.forEach((c, i) => {
      const region = REGIONS[clean(rows6[h6][c])];
      const key = `${region}:${d?.code ?? "TOT"}`;
      const row = byKey.get(key) ?? { region, code: d?.code ?? "TOT", name: d?.name ?? "All offenders", slug: d?.slug ?? "total", counts: [], rates: [] };
      row.counts.push(num(r[c]));
      row.rates.push(num(r[rateRegionCols[i]]));
      byKey.set(key, row);
    });
  }
  // The table lists the latest year first; put years oldest first to match everything else.
  const order = stateYears.map((y, i) => [y, i] as const).sort((x, y) => x[0].localeCompare(y[0]));
  const sortedYears = order.map(([y]) => y);
  const states = [...byKey.values()].map((r) => ({ ...r, counts: order.map(([, i]) => r.counts[i] ?? null), rates: order.map(([, i]) => r.rates[i] ?? null) }));

  const src = `ABS, Recorded Crime – Offenders, ${edition}`;
  const out: Series[] = [];
  const what = (r: OffenderRow) => (r.code === "TOT" ? "any offence" : r.name.toLowerCase());
  for (const r of national) {
    const cnt = series(`crime:offenders:AUS:${r.slug}`, `${r.name}, offenders, Australia`, "number", 0,
      `People proceeded against by police whose principal offence was ${what(r)}, financial year, Australia.`, src, files.national, years, r.counts);
    const rate = series(`crime:offender-rate:AUS:${r.slug}`, `${r.name}, offenders per 100,000 people, Australia`, "ratio", 1,
      `Offenders per 100,000 people aged 10 and over whose principal offence was ${what(r)}, financial year, Australia.`, src, files.national, years, r.rates);
    if (cnt) out.push(cnt);
    if (rate) out.push(rate);
  }
  for (const r of states) {
    const rate = series(`crime:offender-rate:${r.region}:${r.slug}`, `${r.name}, offenders per 100,000 people, ${REGION_NAMES[r.region]}`, "ratio", 1,
      `Offenders per 100,000 people aged 10 and over whose principal offence was ${what(r)}, financial year, ${REGION_NAMES[r.region]}.`, src, files.states, sortedYears, r.rates);
    if (rate) out.push(rate);
  }
  return { page: OFFENDERS_PAGE, files, edition, years, national, states, stateYears: sortedYears, series: out };
}

// --- public ---------------------------------------------------------------------

const DAY = 86_400;
const cached = {
  victims: unstable_cache(loadVictims, ["crime-victims-v2"], { revalidate: DAY }),
  offenders: unstable_cache(loadOffenders, ["crime-offenders-v2"], { revalidate: DAY }),
};

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try { return { data: await load(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}

export type Crime = { victims: Part<Victims>; offenders: Part<Offenders> };

export async function tryGetCrime(): Promise<Crime> {
  const [victims, offenders] = await Promise.all([part(cached.victims), part(cached.offenders)]);
  return { victims, offenders };
}
