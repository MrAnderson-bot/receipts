// Homelessness from two publishers.
// 1. AIHW Specialist Homelessness Services annual report: everyone who got help
//    from a homelessness service in the year, by state, back to 2011-12, and why
//    they asked. The report's download list is filled in by a search API, which
//    is called here so the file links follow each new edition. Data: AIHW, CC BY 4.0.
// 2. ABS Estimating Homelessness from the Census: the count of people homeless on
//    Census night, every five years. The 2021 tables are the latest until the 2026
//    Census results are published (expected 2028). Data: ABS, CC BY 4.0.
import { unstable_cache } from "next/cache";
import { readWorkbook, USER_AGENT, type Row } from "../xlsx";
import type { Series, Point } from "./types";

const AIHW = "https://www.aihw.gov.au";
const SHS_REPORT = `${AIHW}/reports/homelessness-services/specialist-homelessness-services-annual-report`;
// The report node id and its "data" page id, read from the page's own download component.
const SHS_NODE = { reportNodeGuid: "d23a983e-953f-472f-8de7-1fb358b3a7b0", currentNodeId: "86214" };
const CENSUS_PAGE = "https://www.abs.gov.au/statistics/people/housing/estimating-homelessness-census/latest-release";
const CENSUS_FILE = "https://www.abs.gov.au/statistics/people/housing/estimating-homelessness-census/2021/20490do001_2021.xlsx";
const headers = { "User-Agent": USER_AGENT };

export type Part<T> = { data: T | null; error: string | null };

export type ShsRegion = { region: string; name: string; clients: (number | null)[]; perTenThousand: (number | null)[] };
export type ShsReason = { group: string; reason: string; clients: number | null; percent: number | null; isGroup: boolean };
export type Shs = {
  page: string;
  files: { history: { title: string; url: string; date: string }; tables: { title: string; url: string; date: string } };
  years: string[]; // FY2011-12 ...
  latestYear: string;
  regions: ShsRegion[]; // National first
  reasons: ShsReason[]; // national, latest year, as listed by the AIHW
  series: Series[];
};

export type CensusGroup = { name: string; count: number | null; rate: number | null };
export type Census = {
  page: string;
  file: string;
  years: string[]; // "2006", "2011", "2016", "2021"
  total: { counts: (number | null)[]; rates: (number | null)[] };
  groups: CensusGroup[]; // where people were living, latest Census
  states: CensusGroup[]; // latest Census
  series: Series[];
};

const REGIONS: Record<string, string> = {
  National: "AUS", Australia: "AUS", "New South Wales": "NSW", Victoria: "VIC", Queensland: "QLD", "South Australia": "SA",
  "Western Australia": "WA", Tasmania: "TAS", "Northern Territory": "NT", "Australian Capital Territory": "ACT",
  NSW: "NSW", Vic: "VIC", Qld: "QLD", SA: "SA", WA: "WA", Tas: "TAS", NT: "NT", ACT: "ACT",
};
const NAMES: Record<string, string> = {
  AUS: "Australia", NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia",
  WA: "Western Australia", TAS: "Tasmania", NT: "Northern Territory", ACT: "Australian Capital Territory",
};

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const clean = (s: string | undefined) => (s ?? "").replace(/\([a-z]{1,2}\)/g, "").replace(/\s+/g, " ").trim();
const num = (v: string | undefined): number | null => {
  const n = Number((v ?? "").trim());
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const fy = (label: string) => `FY${label.replace(/[–—]/g, "-").slice(0, 7)}`;

function series(id: string, label: string, unit: Series["unit"], decimals: number, note: string, source: string, sourceUrl: string, periods: string[], values: (number | null)[]): Series | null {
  const points: Point[] = periods.flatMap((p, i) => (values[i] === null ? [] : [{ period: p, value: values[i]! }]));
  return points.length ? { id, label, unit, frequency: "yearly", decimals, note, source, sourceUrl, points } : null;
}

async function workbook(url: string, who: string) {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`${who} returned ${res.status} for ${url}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}

// --- AIHW ---------------------------------------------------------------------

type Resource = { resultTitle: string; resultUrl: string; resultDateTimeFormatted: string; resultFileType: string };

async function shsFiles() {
  const res = await fetch(`${AIHW}/api/search/all-downloadable-resources`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ ...SHS_NODE, filterByChildrenOfCurrentNode: true, orderByColumn: "NodeOrder", itemsPerPage: 50, page: 1, keywords: [], ignoredResourceGuids: "" }),
  });
  if (!res.ok) throw new Error(`AIHW returned ${res.status} for the report's download list`);
  const results: Resource[] = (await res.json()).results ?? [];
  const pick = (test: RegExp) => {
    const r = results.find((x) => x.resultFileType === "XLSX" && test.test(x.resultTitle));
    if (!r) throw new Error(`AIHW download list has no spreadsheet matching ${test.source}`);
    return { title: r.resultTitle, url: r.resultUrl.startsWith("http") ? r.resultUrl : AIHW + r.resultUrl, date: r.resultDateTimeFormatted };
  };
  return { history: pick(/historical tables/i), tables: pick(/^Data tables: Specialist homelessness services annual report/i) };
}

async function loadShs(): Promise<Shs> {
  const files = await shsFiles();
  const [hist, tables] = await Promise.all([workbook(files.history.url, "AIHW"), workbook(files.tables.url, "AIHW")]);

  // HIST.CLIENTS: State/territory | Data type | Sex | one column per year | Average annual change
  const rows = hist.sheet("HIST.CLIENTS");
  const h = rows.findIndex((r) => /^State/i.test((r.A ?? "").trim()) && /^Data type/i.test((r.B ?? "").trim()));
  if (h < 0) throw new Error("HIST.CLIENTS has no header row");
  const yearCols = Object.keys(rows[h]).filter((c) => /^\d{4}[–-]\d{2}$/.test((rows[h][c] ?? "").trim())).sort((a, b) => colNum(a) - colNum(b));
  const years = yearCols.map((c) => fy(rows[h][c].trim()));
  const byRegion = new Map<string, ShsRegion>();
  for (const r of rows.slice(h + 1)) {
    const region = REGIONS[clean(r.A)];
    if (!region || !/^all clients$/i.test(clean(r.C))) continue;
    const type = clean(r.B);
    const entry = byRegion.get(region) ?? { region, name: NAMES[region], clients: years.map(() => null), perTenThousand: years.map(() => null) };
    if (/^clients \(number\)/i.test(type)) entry.clients = yearCols.map((c) => num(r[c]));
    else if (/per 10,000/i.test(type)) entry.perTenThousand = yearCols.map((c) => num(r[c]));
    byRegion.set(region, entry);
  }
  const regions = ["AUS", ...Object.keys(NAMES).filter((k) => k !== "AUS")].flatMap((k) => byRegion.get(k) ?? []);
  if (!regions.find((r) => r.region === "AUS")) throw new Error("HIST.CLIENTS has no National rows");

  // CLIENTS.21: State/territory | Group | Reason | Males | Females | Total (number) | Total (per cent). National block only.
  const reasonRows = tables.sheet("CLIENTS.21");
  const rh = reasonRows.findIndex((r) => /^Reason/i.test((r.C ?? "").trim()));
  if (rh < 0) throw new Error("CLIENTS.21 has no header row");
  const reasons: ShsReason[] = [];
  for (const r of reasonRows.slice(rh + 1)) {
    if (!/^national$/i.test(clean(r.A))) { if (reasons.length) break; else continue; }
    const group = clean(r.B), reason = clean(r.C);
    if (/^not stated$/i.test(group)) continue;
    reasons.push({ group, reason, clients: num(r.F), percent: num(r.G), isGroup: group.toLowerCase() === reason.toLowerCase() });
  }
  if (!reasons.length) throw new Error("CLIENTS.21 has no National rows");

  const latestYear = years[years.length - 1];
  const src = `AIHW, Specialist homelessness services annual report ${latestYear.replace(/^FY/, "")}`;
  const out: Series[] = [];
  for (const r of regions) {
    const a = series(`homelessness:shs-clients:${r.region}`, `People helped by homelessness services, ${r.name}`, "people", 0,
      `Clients of specialist homelessness services in the financial year, ${r.name}. One person counted once however many times they were helped.`, src, files.history.url, years, r.clients);
    const b = series(`homelessness:shs-rate:${r.region}`, `Homelessness service clients per 10,000 people, ${r.name}`, "ratio", 1,
      `Clients of specialist homelessness services per 10,000 residents, ${r.name}, financial year.`, src, files.history.url, years, r.perTenThousand);
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return { page: `${SHS_REPORT}/data`, files, years, latestYear, regions, reasons, series: out };
}

// --- ABS Census ------------------------------------------------------------------

async function loadCensus(): Promise<Census> {
  const wb = await workbook(CENSUS_FILE, "ABS");
  const rows = wb.sheet("Table_1.1");
  // Year row: Census years across, three columns each (no., %, rate).
  const yh = rows.findIndex((r) => Object.values(r).filter((v) => /^\d{4}$/.test((v ?? "").trim())).length >= 2);
  if (yh < 0) throw new Error("Census Table 1.1 has no year row");
  const yearCols = Object.keys(rows[yh]).filter((c) => /^\d{4}$/.test((rows[yh][c] ?? "").trim())).sort((a, b) => colNum(a) - colNum(b));
  const years = yearCols.map((c) => rows[yh][c].trim());
  const rateCol = (c: string) => { let n = colNum(c) + 2, s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const read = (r: Row) => ({ counts: yearCols.map((c) => num(r[c])), rates: yearCols.map((c) => num(r[rateCol(c)])) });

  const find = (test: RegExp, from = 0) => rows.findIndex((r, i) => i >= from && test.test(clean(r.A)));
  const totalRow = find(/^all homeless persons$/i);
  if (totalRow < 0) throw new Error("Census Table 1.1 has no 'All homeless persons' row");
  const total = read(rows[totalRow]);
  const last = years.length - 1;

  const groupStart = find(/^homeless operational groups/i);
  const groups: CensusGroup[] = [];
  for (let i = groupStart + 1; i > 0 && i < totalRow; i++) {
    const name = clean(rows[i].A);
    if (!name) continue;
    const v = read(rows[i]);
    groups.push({ name, count: v.counts[last], rate: v.rates[last] });
  }
  const stateStart = find(/^state or territory of usual residence/i);
  const states: CensusGroup[] = [];
  for (let i = stateStart + 1; i > 0 && i < rows.length; i++) {
    const name = clean(rows[i].A);
    if (!REGIONS[name] || REGIONS[name] === "AUS") { if (states.length) break; else continue; }
    const v = read(rows[i]);
    states.push({ name, count: v.counts[last], rate: v.rates[last] });
  }

  const src = "ABS, Estimating Homelessness: Census, 2021";
  const out: Series[] = [];
  const a = series("homelessness:census-count:AUS", "People homeless on Census night, Australia", "people", 0,
    "People estimated to be homeless on Census night, in improvised dwellings, supported accommodation, staying with others, boarding houses, other temporary lodgings or severely crowded dwellings.", src, CENSUS_FILE, years, total.counts);
  const b = series("homelessness:census-rate:AUS", "People homeless per 10,000, Australia", "ratio", 1,
    "People estimated to be homeless on Census night per 10,000 residents.", src, CENSUS_FILE, years, total.rates);
  if (a) out.push(a);
  if (b) out.push(b);
  return { page: CENSUS_PAGE, file: CENSUS_FILE, years, total, groups, states, series: out };
}

// --- public ----------------------------------------------------------------------

const DAY = 86_400;
const cached = {
  shs: unstable_cache(loadShs, ["homelessness-shs-v1"], { revalidate: DAY }),
  census: unstable_cache(loadCensus, ["homelessness-census-v1"], { revalidate: DAY }),
};

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try { return { data: await load(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}

export type Homelessness = { shs: Part<Shs>; census: Part<Census> };

export async function tryGetHomelessness(): Promise<Homelessness> {
  const [shs, census] = await Promise.all([part(cached.shs), part(cached.census)]);
  return { shs, census };
}
