// Queensland: there is no central feed. Each agency posts its own "contract
// disclosure" file on data.qld.gov.au (CC BY 4.0), roughly monthly, for
// contracts of $10,000 and over. This reads every agency's recent files through
// the portal's datastore API and lines them up.
import { parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT, excelDate } from "../../xlsx";
import { summarise, type StateContract, type StateSummary } from "./types";

const CKAN = "https://www.data.qld.gov.au/api/3/action";
const DAY = 86_400_000;
const WINDOW_DAYS = 365;
const headers = { "User-Agent": USER_AGENT };

// The disclosure template's columns, matched loosely because agencies retype them.
const FIELDS = {
  agency: [/^agency\s*(name|\(?\s*dept)/i],
  description: [/contract description/i, /^description$/i],
  awarded: [/award(ed)? contract date|contract award date/i, /^posting date$/i],
  value: [/contract value/i, /^value$/i],
  supplier: [/supplier name/i],
  abn: [/supplier abn/i],
  method: [/procurement method/i],
  ref: [/contract reference/i],
} as const;
type Field = keyof typeof FIELDS;

async function json(url: string): Promise<any> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.qld.gov.au returned ${res.status}`);
  return res.json();
}

// Runs jobs a few at a time so the portal isn't hit with a hundred requests at once.
async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await run(items[i]); }
  }));
  return out;
}

// Files converted from Excel often carry dates as serial numbers (46023 is 1 January 2026).
function parseDate(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) > 36_000 && Number(t) < 60_000) return excelDate(t)?.slice(0, 10) ?? null;
  return parseAuDate(t);
}

type FileResult = { name: string; contracts: StateContract[]; skipped?: string };

async function readFile(resource: any, org: string): Promise<FileResult> {
  const name = `${org}: ${resource.name}`;
  try {
    const result = (await json(`${CKAN}/datastore_search?resource_id=${resource.id}&limit=5000`)).result;
    const order: string[] = result.fields.map((f: any) => f.id).filter((id: string) => id !== "_id");
    const index = {} as Record<Field, number>;
    // The template heading wins; an agency's own wording is only used when the template heading is absent.
    for (const f of Object.keys(FIELDS) as Field[]) {
      index[f] = -1;
      for (const pattern of FIELDS[f]) {
        index[f] = order.findIndex((id) => pattern.test(id.trim()));
        if (index[f] >= 0) break;
      }
    }
    if (index.awarded < 0 || index.value < 0 || index.supplier < 0) {
      return { name, contracts: [], skipped: "no award date, value or supplier column" };
    }

    // Some agencies publish files whose values sit one or two columns left of
    // their headings. Accept a file only if one alignment gives rows that parse.
    const records: any[] = result.records;
    if (records.length === 0) return { name, contracts: [], skipped: "the file has no rows" };
    const cell = (rec: any, f: Field, shift: number) => {
      const i = index[f] - shift;
      return i >= 0 && index[f] >= 0 ? rec[order[i]] : null;
    };
    const valid = (rec: any, shift: number) =>
      parseDate(cell(rec, "awarded", shift)) !== null && (parseMoney(cell(rec, "value", shift)) ?? 0) > 0;
    const sample = records.slice(0, 60);
    const shift = [0, 1, 2].find((s) => sample.length > 0 && sample.filter((r) => valid(r, s)).length / sample.length >= 0.7);
    if (shift === undefined) return { name, contracts: [], skipped: "columns don't line up with their headings" };

    const cutoff = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const latest = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
    const contracts: StateContract[] = [];
    for (const rec of records) {
      if (!valid(rec, shift)) continue;
      const awarded = parseDate(cell(rec, "awarded", shift))!;
      const value = parseMoney(cell(rec, "value", shift))!;
      if (awarded < cutoff || awarded > latest || value > 2e10) continue;
      const text = (f: Field) => String(cell(rec, f, shift) ?? "").trim();
      const abn = text("abn").replace(/\s/g, "");
      contracts.push({
        id: text("ref") || `${org}-${awarded}-${value}-${text("supplier")}`,
        // In a shifted file the agency column is unreliable, so the publishing organisation stands in.
        agency: (shift === 0 && text("agency")) || org,
        supplier: text("supplier") || "Not published",
        supplierAbn: /^\d{11}$/.test(abn) ? abn : null,
        description: text("description"),
        method: text("method"),
        category: null,
        value, awarded,
      });
    }
    return { name, contracts };
  } catch (e) {
    return { name, contracts: [], skipped: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadQld(): Promise<StateSummary> {
  const q = encodeURIComponent('title:"contract disclosure"');
  const pages = await Promise.all([0, 200].map((start) =>
    json(`${CKAN}/package_search?q=${q}&rows=200&start=${start}&sort=metadata_modified+desc`)));
  const datasets: any[] = pages.flatMap((p) => p.result?.results ?? []);

  // Only files touched in the last year or so can hold contracts from the last 12 months.
  const since = new Date(Date.now() - (WINDOW_DAYS + 45) * DAY).toISOString();
  const files = datasets.flatMap((d) =>
    (d.resources as any[])
      .filter((r) => r.datastore_active && (r.last_modified ?? r.created ?? "") >= since)
      .sort((a, b) => (b.last_modified ?? b.created).localeCompare(a.last_modified ?? a.created))
      .slice(0, 4)
      .map((r) => ({ resource: r, org: d.organization?.title ?? d.title })));

  const results = await pool(files, 6, (f) => readFile(f.resource, f.org));

  // The same contract often appears in consecutive monthly files.
  const seen = new Map<string, StateContract>();
  for (const c of results.flatMap((r) => r.contracts)) {
    const key = `${c.agency}|${c.id}|${c.supplier}|${c.value}`;
    if (!seen.has(key)) seen.set(key, c);
  }

  return summarise([...seen.values()], {
    code: "QLD", name: "Queensland", noun: "contracts",
    period: "Awarded in the last 12 months",
    coverage: "Contracts of $10,000 and over, as disclosed by each Queensland agency in its own file. Agencies publish on their own schedules, so the most recent months are incomplete, and files that can't be read reliably are left out rather than guessed at.",
    sourceName: "Queensland agency contract disclosure files",
    sourceUrl: "https://www.data.qld.gov.au/dataset/?q=contract+disclosure",
    licence: "CC BY 4.0",
    filesRead: results.filter((r) => !r.skipped).length,
    filesSkipped: results.filter((r) => r.skipped).map((r) => ({ name: r.name, reason: r.skipped! })),
  });
}
