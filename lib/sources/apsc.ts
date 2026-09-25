// Size of the Australian Public Service, from the APS Employment Database
// releases the Australian Public Service Commission publishes on data.gov.au
// (CC BY 3.0 AU). One workbook of about 80 tables every June and December.
//
// Two tables are read from each release:
//   Table 10  all employees: agency by gender and classification level
//   Table 1   all employees: gender by employment category, twenty years back
// Table 10 is stored one cell per row (release, agency, gender, classification,
// headcount) so nothing the publisher gives is lost. Cells published as "." are
// nil and stored as null. Gender X is not reported separately for small cells
// and is only present in each row's total.
import { unstable_cache } from "next/cache";
import { readWorkbook, USER_AGENT, type Row, type Workbook } from "../xlsx";
import type { Series } from "./types";

const CKAN = "https://data.gov.au/data/api/3/action";
const headers = { "User-Agent": USER_AGENT };
const DAY = 86_400;
const RELEASES = 4; // newest releases to load: two years of half-yearly snapshots

export type ApsRow = {
  release: string; // snapshot date, YYYY-MM-DD
  agency: string; // as printed, without the leading "- " that marks a sub-agency
  parent: string | null; // the department a sub-agency sits under
  gender: string; // Men, Women, or All for the row total
  classification: string; // Trainee, Graduate, APS 1 ... SES 3, or Total
  headcount: number | null; // null where the publisher printed "."
  sourceUrl: string;
};

export type ApsRelease = {
  date: string; label: string; title: string; url: string; datasetUrl: string;
  total: number; men: number; women: number; other: number; // other: gender X, only in totals
};
export type LevelRow = { level: string; men: number; women: number; total: number };
export type AgencyRow = { agency: string; parent: string | null; total: number; men: number; women: number; previous: number | null; yearAgo: number | null };

export type Aps = {
  releases: ApsRelease[]; // newest first
  latest: ApsRelease;
  previous: ApsRelease | null;
  yearAgo: ApsRelease | null;
  levels: LevelRow[]; // each classification level, in the publisher's order
  bands: LevelRow[]; // trainees and graduates, APS 1 to 6, EL 1 and 2, SES
  agencies: AgencyRow[]; // every agency in the latest release, largest first
  history: { total: Series; men: Series; women: Series }; // Table 1 of the latest release
  rows: ApsRow[]; // every cell of Table 10 in every loaded release
  skipped: string[]; // releases found but not readable, with the reason
};

const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const cells = (r: Row): [string, string][] => Object.entries(r).sort((a, b) => colNum(a[0]) - colNum(b[0]));
const count = (v: string | undefined): number | null => {
  const n = Number((v ?? "").trim());
  return v !== undefined && v.trim() !== "" && v.trim() !== "." && Number.isFinite(n) ? n : null;
};
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function band(level: string): string {
  if (/^(Trainee|Graduate)/i.test(level)) return "Trainees and graduates";
  if (/^APS/i.test(level)) return "APS 1 to 6";
  if (/^EL/i.test(level)) return "EL 1 and 2";
  if (/^SES/i.test(level)) return "SES";
  return level;
}

// --- finding the releases on data.gov.au ---------------------------------------

export type Found = { date: string; label: string; title: string; url: string; datasetUrl: string };

export async function findReleases(): Promise<Found[]> {
  const q = encodeURIComponent('title:"APS Employment Data"');
  // Not cache: "no-store": the static build refuses to render a route that uses it outside unstable_cache.
  const res = await fetch(`${CKAN}/package_search?q=${q}&sort=metadata_modified+desc&rows=40`, { headers, next: { revalidate: DAY } });
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} searching for APS Employment Data`);
  const results: any[] = (await res.json()).result?.results ?? [];
  const found = new Map<string, Found>();
  for (const p of results) {
    const m = String(p.title ?? "").match(/APS Employment Data (\d{1,2}) ([A-Za-z]+) (\d{4})/);
    const month = m && MONTHS[m[2].toLowerCase()];
    if (!m || !month) continue;
    const date = `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
    const file = (p.resources as any[]).find((r) => /\.xlsx$/i.test(r.url ?? ""));
    if (!file || found.has(date)) continue;
    found.set(date, { date, label: `${Number(m[1])} ${m[2]} ${m[3]}`, title: p.title, url: file.url, datasetUrl: `https://data.gov.au/data/dataset/${p.name}` });
  }
  if (!found.size) throw new Error("data.gov.au lists no APS Employment Data release with a spreadsheet");
  return [...found.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function download(f: Found): Promise<Workbook> {
  const res = await fetch(f.url, { headers, next: { revalidate: DAY } }); // 850 KB, within the fetch cache's 2 MB limit
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} for ${f.title}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}

// The table of contents names every table; the sheet is "Table N".
function findTable(book: Workbook, title: RegExp): Row[] {
  const toc = book.sheetNames.find((n) => /contents/i.test(n));
  const hit = toc ? book.sheet(toc).find((r) => title.test(r.C ?? "")) : undefined;
  const sheet = hit ? `Table ${hit.B?.trim()}` : book.sheetNames.find((n) => title.test(book.sheet(n)[0]?.A ?? ""));
  if (!sheet || !book.sheetNames.includes(sheet)) throw new Error(`no table matching ${title.source}`);
  return book.sheet(sheet);
}

// --- Table 10: agency by gender and classification ----------------------------

function readTable10(rows: Row[], f: Found): ApsRow[] {
  const h = rows.findIndex((r) => (r.A ?? "").trim() === "Agency");
  if (h < 0 || !rows[h + 1]) throw new Error(`${f.label}: Table 10 has no "Agency" header row`);
  const labels = cells(rows[h]).filter(([c]) => c !== "A");
  const cols: { col: string; classification: string; gender: string }[] = [];
  for (const [col, g] of cells(rows[h + 1])) {
    const label = [...labels].reverse().find(([c]) => colNum(c) <= colNum(col))?.[1]?.trim();
    if (label && /^(Men|Women)$/i.test(g.trim())) cols.push({ col, classification: label, gender: g.trim() });
  }
  const totalCol = labels.find(([, l]) => /^Total$/i.test(l.trim()))?.[0];
  if (!cols.length || !totalCol) throw new Error(`${f.label}: Table 10 header has no gender columns or no Total column`);

  const out: ApsRow[] = [];
  let parent: string | null = null;
  for (const r of rows.slice(h + 2)) {
    const raw = (r.A ?? "").trim();
    if (!raw || /^Source:/i.test(raw) || /^\d+\./.test(raw)) continue;
    const sub = raw.startsWith("-");
    const agency = sub ? raw.replace(/^-\s*/, "") : raw;
    const isTotal = /^Total$/i.test(agency);
    if (!sub && !isTotal) parent = agency;
    const base = { release: f.date, agency, parent: sub ? parent : null, sourceUrl: f.datasetUrl };
    for (const c of cols) out.push({ ...base, gender: c.gender, classification: c.classification, headcount: count(r[c.col]) });
    out.push({ ...base, gender: "All", classification: "Total", headcount: count(r[totalCol]) });
    if (isTotal) break;
  }
  if (!out.some((r) => r.agency === "Total")) throw new Error(`${f.label}: Table 10 has no Total row`);
  return out;
}

// --- Table 1: gender by employment category over twenty years ------------------

function readTable1(rows: Row[], f: Found): Aps["history"] {
  // The sheet has three blocks (Ongoing, Non-ongoing, Total); the last is the one wanted.
  const t = rows.map((r, i) => ((r.A ?? "").trim() === "Total" ? i : -1)).filter((i) => i >= 0).find((i) => /^Gender$/i.test((rows[i + 1]?.A ?? "").trim()));
  if (t === undefined) throw new Error(`${f.label}: Table 1 has no Total block`);
  const monthWord = (rows[t + 1].B ?? "").trim().toLowerCase();
  const month = MONTHS[monthWord];
  const yearRow = rows[t + 2];
  if (!month || !yearRow) throw new Error(`${f.label}: Table 1 Total block has no month or year row`);
  const years = cells(yearRow).filter(([, y]) => /^\d{4}$/.test(y.trim()));
  const pick = (name: RegExp) => {
    const r = rows.slice(t + 3, t + 9).find((r) => name.test((r.A ?? "").trim()));
    return years.map(([col, y]) => ({ period: `${y.trim()}-${month}`, value: count(r?.[col]) })).filter((p): p is { period: string; value: number } => p.value !== null);
  };
  const series = (id: string, label: string, name: RegExp, note: string): Series => ({
    id, label, unit: "people", frequency: "yearly", decimals: 0, note,
    source: "Australian Public Service Commission, APS Employment Database", sourceUrl: f.datasetUrl, points: pick(name),
  });
  const history = {
    total: series("aps-headcount", "Public servants", /^Total$/i, "Everyone employed under the Public Service Act at the snapshot date, ongoing and non-ongoing, full and part time, by headcount not full-time equivalent."),
    men: series("aps-headcount-men", "Public servants, men", /^Men$/i, "Headcount of men in the APS at the snapshot date."),
    women: series("aps-headcount-women", "Public servants, women", /^Women$/i, "Headcount of women in the APS at the snapshot date."),
  };
  if (!history.total.points.length) throw new Error(`${f.label}: Table 1 Total block has no figures`);
  return history;
}

// --- putting a release together -----------------------------------------------

function summarise(rows: ApsRow[], f: Found): ApsRelease {
  const totalRow = rows.filter((r) => r.agency === "Total");
  const total = totalRow.find((r) => r.gender === "All")?.headcount ?? 0;
  const men = sum(totalRow.filter((r) => r.gender === "Men").map((r) => r.headcount));
  const women = sum(totalRow.filter((r) => r.gender === "Women").map((r) => r.headcount));
  return { ...f, total, men, women, other: total - men - women };
}

async function load(): Promise<Aps> {
  const found = (await findReleases()).slice(0, RELEASES);
  const rows: ApsRow[] = [];
  const releases: ApsRelease[] = [];
  const skipped: string[] = [];
  let history: Aps["history"] | null = null;
  for (const f of found) {
    try {
      const book = await download(f);
      const t10 = readTable10(findTable(book, /agency by gender and classification level/i), f);
      rows.push(...t10);
      releases.push(summarise(t10, f));
      if (!history) history = readTable1(findTable(book, /gender by employment category/i), f);
    } catch (e) {
      skipped.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!releases.length || !history) throw new Error(`No APS release could be read. ${skipped.join("; ")}`);

  const latest = releases[0];
  const previous = releases[1] ?? null;
  const yearAgo = releases.find((r) => r.date.slice(0, 7) === `${Number(latest.date.slice(0, 4)) - 1}${latest.date.slice(4, 7)}`) ?? null;
  const inLatest = rows.filter((r) => r.release === latest.date);
  const totalRows = inLatest.filter((r) => r.agency === "Total" && r.gender !== "All");
  const order = [...new Set(totalRows.map((r) => r.classification))];
  const levels: LevelRow[] = order.map((level) => {
    const men = sum(totalRows.filter((r) => r.classification === level && r.gender === "Men").map((r) => r.headcount));
    const women = sum(totalRows.filter((r) => r.classification === level && r.gender === "Women").map((r) => r.headcount));
    return { level, men, women, total: men + women };
  });
  const bands: LevelRow[] = [...new Set(order.map(band))].map((b) => {
    const parts = levels.filter((l) => band(l.level) === b);
    return { level: b, men: sum(parts.map((p) => p.men)), women: sum(parts.map((p) => p.women)), total: sum(parts.map((p) => p.total)) };
  });

  const totalOf = (release: string | undefined, agency: string) =>
    release ? rows.find((r) => r.release === release && r.agency === agency && r.gender === "All")?.headcount ?? null : null;
  const agencies: AgencyRow[] = [...new Map(inLatest.filter((r) => r.agency !== "Total").map((r) => [r.agency, r])).values()].map((r) => {
    const mine = inLatest.filter((x) => x.agency === r.agency);
    return {
      agency: r.agency, parent: r.parent,
      total: mine.find((x) => x.gender === "All")?.headcount ?? 0,
      men: sum(mine.filter((x) => x.gender === "Men").map((x) => x.headcount)),
      women: sum(mine.filter((x) => x.gender === "Women").map((x) => x.headcount)),
      previous: totalOf(previous?.date, r.agency),
      yearAgo: totalOf(yearAgo?.date, r.agency),
    };
  }).sort((a, b) => b.total - a.total);

  return { releases, latest, previous, yearAgo, levels, bands, agencies, history, rows, skipped };
}

// The pages need the summary; the daily snapshot needs every row as well. The rows run to
// several megabytes across four releases, more than Next's cache will hold, so the summary
// is cached on its own and the snapshot reads the workbooks afresh.
export type ApsSummary = Omit<Aps, "rows">;

const cached = unstable_cache(async (): Promise<ApsSummary> => {
  const { rows, ...summary } = await load();
  return summary;
}, ["apsc-v2"], { revalidate: DAY });

export async function tryGetAps(): Promise<{ data: ApsSummary | null; error: string | null }> {
  try { return { data: await cached(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}

// Uncached, with every row: for the snapshot only.
export const loadAps = load;

// One release's agency-by-gender-by-classification rows, for the backfill (docs/backfill.md).
export async function loadRelease(f: Found): Promise<{ rows: ApsRow[]; release: ApsRelease }> {
  const book = await download(f);
  const rows = readTable10(findTable(book, /agency by gender and classification level/i), f);
  return { rows, release: summarise(rows, f) };
}
