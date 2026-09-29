// The Final Budget Outcome: Treasury's report, each September, of what the year actually cost and raised,
// against what the Budget had estimated. Published as PDF and Word only. The Word file for Part 1 is a zip of
// XML, and its tables read cleanly: Table 1.3 cash receipts by head, Table 1.5 expenses by function (with the
// sub-functions), Table 1.6 net capital investment by function. Each has an "Estimate at ... Budget" column
// and an "Outcome" column. Files: https://archive.budget.gov.au/<year>/fbo/download/01_part_1.docx, present
// for 2019-20 onward except 2022-23 (found 29 September 2026). Data: Commonwealth of Australia, CC BY 4.0.
import { unstable_cache } from "next/cache";
import { unzip, USER_AGENT } from "../xlsx";
import type { Series } from "./types";

const DAY = 86_400;
export const FBO_YEARS = ["2019-20", "2020-21", "2021-22", "2023-24", "2024-25"];
export const fboUrl = (year: string) => `https://archive.budget.gov.au/${year}/fbo/download/01_part_1.docx`;
export const fboPage = (year: string) => `https://archive.budget.gov.au/${year}/index.htm#fbo`;

export type FboLine = {
  name: string;
  group: string | null; // the heading a sub-line sits under, e.g. "General public services"
  estimate: number | null; // $m, the Budget's estimate for the year
  outcome: number | null; // $m, what happened
  derived: boolean; // a group total summed from its sub-lines, because the table gives the group no figure
};

export type Fbo = {
  year: string;
  sourceUrl: string;
  pageUrl: string;
  receipts: FboLine[]; // Table 1.3
  functions: FboLine[]; // Table 1.5, every line
  capital: FboLine[]; // Table 1.6
  totals: { receipts: FboLine | null; expenses: FboLine | null; capital: FboLine | null };
};

// --- the Word file ---------------------------------------------------------------------------

// Cell text: run text joined, tabs kept, the Symbol-font minus (w:sym) and non-breaking hyphen made a minus.
const cellText = (xml: string) =>
  xml.replace(/<w:sym[^>]*w:char="F02D"[^>]*\/>/g, "-").replace(/<w:noBreakHyphen\/>/g, "-").replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

// A table cell: its text and how far its paragraph is indented (twentieths of a point). The budget tables
// show a sub-line by indenting it, and that indent is the only mark of the grouping.
export type Cell = { text: string; indent: number };

// Every table in the document as rows of cells, each with the paragraph that precedes it (its caption).
export function docxTables(buf: Buffer): { caption: string; rows: Cell[][] }[] {
  const files = unzip(buf);
  const doc = files.get("word/document.xml");
  if (!doc) throw new Error("Not a Word document: no word/document.xml");
  const xml = doc().toString("utf8");
  const out: { caption: string; rows: Cell[][] }[] = [];
  let caption = "";
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
    if (m[0].startsWith("<w:tbl>")) {
      const rows = [...m[0].matchAll(/<w:tr[ >]([\s\S]*?)<\/w:tr>/g)].map((r) =>
        [...r[1].matchAll(/<w:tc[ >]([\s\S]*?)<\/w:tc>/g)].map((c) => ({ text: cellText(c[1]), indent: Number(c[1].match(/<w:ind [^>]*w:left="(\d+)"/)?.[1] ?? 0) })));
      out.push({ caption, rows });
    } else {
      // Captions carry Word field codes ("LINK Excel.Sheet ..."); keep the title before them.
      const t = cellText(m[0]).replace(/\s*LINK Excel.*$/i, "");
      if (t) caption = t;
    }
  }
  return out;
}

// "295,827" -> 295827; "(1,272)" and "-1,272" -> -1272; "" / "na" / "nfp" -> null.
const num = (s: string): number | null => {
  const t = s.replace(/\s/g, "");
  if (!t || /^(na|nfp|n\/a|\.\.|-)$/i.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^[-−–]/.test(t);
  const v = Number(t.replace(/[(),\-−–]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};

// A budget table: header rows down to the "$m" row give the column meanings; below that, lines. A line with
// a name and no figures is a group heading; the indented lines after it are its sub-lines, and the group
// ends at the next line that is not indented. A group with no figure of its own gets the sum of its
// sub-lines ("less:" lines subtracted), marked derived. A "Total X" line stands on its own.
function parseTable(rows: Cell[][]): FboLine[] {
  const unit = rows.findIndex((r) => r.slice(1).some((c) => /^\$[mb]$/.test(c.text)));
  if (unit < 0) throw new Error("No $m row in table");
  const width = Math.max(...rows.map((r) => r.length));
  const header = (col: number) => rows.slice(0, unit).map((r) => r[col]?.text ?? "").join(" ");
  let estimateCol = -1, outcomeCol = -1;
  for (let c = 1; c < width; c++) {
    const h = header(c);
    if (/Outcome/i.test(h) && outcomeCol < 0) outcomeCol = c;
    if (/Estimate/i.test(h) && estimateCol < 0) estimateCol = c;
  }
  if (outcomeCol < 0) throw new Error("No Outcome column in table");
  const lines: FboLine[] = [];
  let group: string | null = null;
  let groupLine: FboLine | null = null;
  for (const r of rows.slice(unit + 1)) {
    const name = (r[0]?.text ?? "").replace(/\(\w\)$/, "").trim();
    if (!name) continue;
    const indented = (r[0]?.indent ?? 0) > 0;
    if (!indented) { group = null; groupLine = null; }
    const outcome = num(r[outcomeCol]?.text ?? ""), estimate = estimateCol >= 0 ? num(r[estimateCol]?.text ?? "") : null;
    const hasFigures = r.slice(1).some((c) => num(c.text) !== null);
    if (!hasFigures) {
      if (/^(memorandum|total)/i.test(name) || indented) continue;
      group = name;
      groupLine = { name, group: null, estimate: 0, outcome: 0, derived: true };
      lines.push(groupLine);
      continue;
    }
    const total = /^total /i.test(name);
    lines.push({ name, group: indented && !total ? group : null, estimate, outcome, derived: false });
    if (groupLine && indented && !total) {
      const sign = /^less:/i.test(name) ? -1 : 1;
      groupLine.estimate = groupLine.estimate === null || estimate === null ? groupLine.estimate : groupLine.estimate + sign * estimate;
      groupLine.outcome = groupLine.outcome === null || outcome === null ? groupLine.outcome : groupLine.outcome + sign * outcome;
    }
  }
  return lines;
}

export function parseFbo(buf: Buffer, year: string): Fbo {
  const tables = docxTables(buf);
  const find = (re: RegExp) => tables.find((t) => re.test(t.caption));
  // Matched on the title, not the number: the 2024-25 file numbers them 1.3, 1.5 and 1.6, the 2019-20 file 4, 6 and 8.
  const receiptsT = find(/\(cash\) receipts/i), functionsT = find(/expenses by function/i), capitalT = find(/net capital investment by function/i);
  if (!functionsT) throw new Error(`FBO ${year}: no "expenses by function" table; the layout may have changed`);
  const receipts = receiptsT ? parseTable(receiptsT.rows) : [];
  const functions = parseTable(functionsT.rows);
  const capital = capitalT ? parseTable(capitalT.rows) : [];
  const total = (lines: FboLine[], re: RegExp) => lines.find((l) => re.test(l.name)) ?? null;
  return {
    year, sourceUrl: fboUrl(year), pageUrl: fboPage(year), receipts, functions, capital,
    totals: { receipts: total(receipts, /^Total receipts/i), expenses: total(functions, /^Total expenses/i), capital: total(capital, /^Total net capital/i) },
  };
}

// --- loading ---------------------------------------------------------------------------------

export async function fetchFbo(year: string): Promise<Fbo> {
  const res = await fetch(fboUrl(year), { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`archive.budget.gov.au returned ${res.status} for the ${year} Final Budget Outcome`);
  return parseFbo(Buffer.from(await res.arrayBuffer()), year);
}

export type FboAll = { years: Fbo[]; latest: Fbo; missing: string[] };

// Every year's outcome, oldest first; a year that fails is listed, not fatal, so one bad file can't hide the rest.
async function load(): Promise<FboAll> {
  const years: Fbo[] = [], missing: string[] = [];
  for (const y of FBO_YEARS) {
    try { years.push(await fetchFbo(y)); } catch (e) { missing.push(`${y}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (years.length === 0) throw new Error(`No Final Budget Outcome could be read: ${missing.join("; ")}`);
  return { years, latest: years[years.length - 1], missing };
}

// The files change once a year, so one read a day is plenty; only the parsed tables are cached.
export const getFbo = unstable_cache(load, ["fbo-v1"], { revalidate: DAY });

export async function tryGetFbo(): Promise<{ data: FboAll | null; error: string | null }> {
  try { return { data: await getFbo(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}

// --- for the store ------------------------------------------------------------------------------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SRC = "Treasury, Final Budget Outcome, Part 1";

// One yearly series per top-level function (outcome) and per receipts head, across every year read.
export function fboSeries(all: FboAll): Series[] {
  const out = new Map<string, Series>();
  const add = (id: string, label: string, note: string, year: string, value: number | null, url: string) => {
    if (value === null) return;
    const s = out.get(id) ?? { id, label, unit: "AUD", frequency: "yearly", note, source: SRC, sourceUrl: url, points: [] };
    s.points.push({ period: `FY${year}`, value: value * 1_000_000 });
    out.set(id, s);
  };
  for (const f of all.years) {
    for (const l of f.functions) {
      if (l.group) continue; // sub-lines roll up into their group
      add(`fbo-fn:${slug(l.name)}`, `${l.name}, final outcome`, "Expenses by function, actual, from the Final Budget Outcome (Table 1.5). A group total is the sum of its sub-lines where the table gives none.", f.year, l.outcome, f.pageUrl);
    }
    for (const l of f.receipts) {
      if (l.group || l.derived) continue;
      add(`fbo-receipt:${slug(l.name)}`, `${l.name}, receipts, final outcome`, "Cash receipts by head, actual, from the Final Budget Outcome (Table 1.3).", f.year, l.outcome, f.pageUrl);
    }
  }
  return [...out.values()];
}
