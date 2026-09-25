// Work expenses of current and former parliamentarians, from the Independent
// Parliamentary Expenses Authority's quarterly reports. IPEA publishes each
// quarter as a CSV on data.gov.au (one row per expense line, every column
// kept here as published). Data: IPEA, CC BY.
// Reports: https://www.ipea.gov.au/reporting/expenditure
// Datasets: https://data.gov.au/data/organization/ipea
import { unstable_cache } from "next/cache";
import { parseCsv } from "../csv";
import { USER_AGENT } from "../xlsx";

const CKAN = "https://data.gov.au/data/api/3/action/package_search?q=organization:ipea&rows=100";
export const QUARTERS = 5; // the latest four, plus the same quarter a year earlier for comparison

// The CSV's columns, in the order IPEA publishes them. The stored table has one column per entry.
export const EXPENSE_COLUMNS = [
  "UniqueId", "ReportingPeriodId", "ReportingPeriod", "ReportingPeriodStartDate", "ReportingPeriodEndDate", "OfficeCode",
  "StateOrTerritory", "Homebase", "Electorate", "FullNameWithTitle", "Party", "Surname", "FirstName", "Role", "UserSurname",
  "UserFirstName", "UserId", "HighLevelCategory", "MajorSubCategory", "MinorSubCategory", "FromDate", "ToDate", "NumberNights",
  "NightlyRate", "Description", "FromLocation", "ToLocation", "Amount", "TripSequence", "LegNumber", "ReasonForTravel",
  "PublishableNotes", "TotalNumOfEmployeesTravelled",
] as const;
export type ExpenseColumn = (typeof EXPENSE_COLUMNS)[number];

// One expense line exactly as published, plus the amount as a number and where it came from.
export type ExpenseRow = Record<ExpenseColumn, string> & { amount: number; sourceUrl: string };

export type Quarter = {
  id: string; // 2026Q02
  period: string; // Apr-Jun 2026
  start: string; // 2026-04-01
  end: string;
  url: string; // the CSV
  datasetUrl: string; // the data.gov.au dataset page
  licence: string;
};

type Bucket = { name: string; value: number; count: number };

export type Person = {
  name: string; // FullNameWithTitle
  surname: string;
  firstName: string;
  role: string;
  party: string;
  state: string;
  electorate: string;
  total: number;
  count: number;
  categories: Bucket[]; // by HighLevelCategory, largest first
  reportUrl: string; // IPEA's page for this person and quarter
};

export type LineItem = {
  uniqueId: string;
  name: string;
  party: string;
  category: string;
  subCategory: string;
  description: string;
  fromDate: string;
  toDate: string;
  fromLocation: string;
  toLocation: string;
  nights: string;
  amount: number;
  reportUrl: string;
  sourceUrl: string;
};

export type ExpenseSummary = {
  latest: Quarter & { total: number; rows: number; people: number };
  yearEarlier: (Quarter & { total: number; rows: number }) | null;
  quarters: { id: string; period: string; total: number; rows: number }[]; // oldest first
  categories: (Bucket & { yearEarlier: number | null })[]; // HighLevelCategory, latest quarter
  subCategories: Bucket[]; // MajorSubCategory, latest quarter
  parties: Bucket[];
  roles: Bucket[];
  states: Bucket[];
  top: Person[]; // latest quarter, 20 largest
  biggest: LineItem[]; // latest quarter, 25 largest lines
  columns: readonly string[];
};

// IPEA's own report page for one person in one quarter, e.g.
// https://www.ipea.gov.au/pwe/full-report/Leigh/Andrew/Parliamentarian/2020-07-01
export const reportUrl = (surname: string, firstName: string, role: string, start: string) =>
  `https://www.ipea.gov.au/pwe/full-report/${[surname, firstName, role, start].map((s) => encodeURIComponent(s)).join("/")}`;

// Every quarterly extract IPEA has put on data.gov.au, newest first.
async function listQuarters(): Promise<Quarter[]> {
  const res = await fetch(CKAN, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 21_600 } });
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} listing IPEA datasets`);
  const json: any = await res.json();
  const out: Quarter[] = [];
  for (const pkg of json.result?.results ?? []) {
    for (const r of pkg.resources ?? []) {
      const m = String(r.url ?? "").match(/(\d{4})q(\d{2})_dataextract\.csv$/i);
      if (!m) continue;
      out.push({
        id: `${m[1]}Q${m[2]}`, period: "", start: "", end: "", url: r.url,
        datasetUrl: `https://data.gov.au/data/dataset/${pkg.name}`,
        licence: pkg.license_title ?? pkg.license_id ?? "not stated",
      });
    }
  }
  out.sort((a, b) => b.id.localeCompare(a.id));
  if (out.length === 0) throw new Error("No IPEA quarterly extracts found on data.gov.au");
  return out;
}

// Plain Node HTTPS, not Next's fetch: each file is about 10 MB, past what the fetch cache
// will hold, and an uncached fetch is refused during the static build. The summary is what
// gets cached. data.gov.au redirects downloads to its storage bucket.
function rawGet(url: string, hops = 0): Promise<{ status: number; body: string }> {
  const https = (process as any).getBuiltinModule?.("node:https");
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": USER_AGENT } }, (res: any) => {
      const to = res.headers.location as string | undefined;
      if (res.statusCode >= 300 && res.statusCode < 400 && to) {
        res.resume();
        if (hops >= 5) return reject(new Error("Too many redirects"));
        return resolve(rawGet(new URL(to, url).toString(), hops + 1));
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function readQuarter(q: Quarter): Promise<{ quarter: Quarter; rows: ExpenseRow[] }> {
  const { status, body } = await rawGet(q.url);
  if (status !== 200) throw new Error(`data.gov.au returned ${status} for ${q.id}`);
  const table = parseCsv(body);
  const head = table[0] ?? [];
  const missing = EXPENSE_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`IPEA ${q.id} is missing columns: ${missing.join(", ")}`);
  const idx = Object.fromEntries(EXPENSE_COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<ExpenseColumn, number>;
  const rows: ExpenseRow[] = [];
  for (const r of table.slice(1)) {
    const row = {} as ExpenseRow;
    for (const c of EXPENSE_COLUMNS) row[c] = r[idx[c]] ?? "";
    if (!row.UniqueId) continue;
    row.amount = Number(row.Amount) || 0;
    row.sourceUrl = q.url;
    rows.push(row);
  }
  const first = rows[0];
  const quarter = first
    ? { ...q, period: first.ReportingPeriod, start: first.ReportingPeriodStartDate, end: first.ReportingPeriodEndDate }
    : q;
  return { quarter, rows };
}

// The latest QUARTERS quarters, newest first, every row. Used by the snapshot to fill the table.
export async function loadQuarters(): Promise<{ quarter: Quarter; rows: ExpenseRow[] }[]> {
  const all = await listQuarters();
  return Promise.all(all.slice(0, QUARTERS).map(readQuarter));
}

function bump(map: Map<string, Bucket>, name: string, value: number) {
  const b = map.get(name) ?? { name, value: 0, count: 0 };
  b.value += value;
  b.count++;
  map.set(name, b);
}
const ranked = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.value - a.value);
const total = (rows: ExpenseRow[]) => rows.reduce((s, r) => s + r.amount, 0);

export function summarise(loaded: { quarter: Quarter; rows: ExpenseRow[] }[]): ExpenseSummary {
  const newest = [...loaded].sort((a, b) => b.quarter.id.localeCompare(a.quarter.id));
  const { quarter: latest, rows } = newest[0];
  const yearEarlierId = `${Number(latest.id.slice(0, 4)) - 1}${latest.id.slice(4)}`;
  const prior = newest.find((l) => l.quarter.id === yearEarlierId) ?? null;

  const categories = new Map<string, Bucket>(), subs = new Map<string, Bucket>(), parties = new Map<string, Bucket>();
  const roles = new Map<string, Bucket>(), states = new Map<string, Bucket>();
  const people = new Map<string, Person & { cats: Map<string, Bucket> }>();
  for (const r of rows) {
    bump(categories, r.HighLevelCategory || "Not categorised", r.amount);
    bump(subs, r.MajorSubCategory || r.HighLevelCategory || "Not categorised", r.amount);
    bump(parties, r.Party || "No party recorded", r.amount);
    bump(roles, r.Role || "Not stated", r.amount);
    bump(states, r.StateOrTerritory || "Not stated", r.amount);
    const key = `${r.Surname}|${r.FirstName}|${r.Role}`;
    const p = people.get(key) ?? {
      name: r.FullNameWithTitle, surname: r.Surname, firstName: r.FirstName, role: r.Role, party: r.Party,
      state: r.StateOrTerritory, electorate: r.Electorate, total: 0, count: 0, categories: [], cats: new Map(),
      reportUrl: reportUrl(r.Surname, r.FirstName, r.Role, r.ReportingPeriodStartDate),
    };
    p.total += r.amount;
    p.count++;
    bump(p.cats, r.HighLevelCategory || "Not categorised", r.amount);
    people.set(key, p);
  }
  const priorCats = new Map<string, Bucket>();
  for (const r of prior?.rows ?? []) bump(priorCats, r.HighLevelCategory || "Not categorised", r.amount);

  const top = [...people.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
    .map(({ cats, ...p }) => ({ ...p, categories: ranked(cats) }));

  const biggest: LineItem[] = [...rows]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25)
    .map((r) => ({
      uniqueId: r.UniqueId, name: r.FullNameWithTitle, party: r.Party, category: r.HighLevelCategory, subCategory: r.MajorSubCategory,
      description: r.Description, fromDate: r.FromDate, toDate: r.ToDate, fromLocation: r.FromLocation, toLocation: r.ToLocation,
      nights: r.NumberNights, amount: r.amount, reportUrl: reportUrl(r.Surname, r.FirstName, r.Role, r.ReportingPeriodStartDate),
      sourceUrl: r.sourceUrl,
    }));

  return {
    latest: { ...latest, total: total(rows), rows: rows.length, people: people.size },
    yearEarlier: prior ? { ...prior.quarter, total: total(prior.rows), rows: prior.rows.length } : null,
    quarters: [...newest].reverse().map((l) => ({ id: l.quarter.id, period: l.quarter.period, total: total(l.rows), rows: l.rows.length })),
    categories: ranked(categories).map((b) => ({ ...b, yearEarlier: prior ? priorCats.get(b.name)?.value ?? 0 : null })),
    subCategories: ranked(subs).slice(0, 12),
    parties: ranked(parties),
    roles: ranked(roles),
    states: ranked(states),
    top,
    biggest,
    columns: EXPENSE_COLUMNS,
  };
}

const cached = unstable_cache(async () => summarise(await loadQuarters()), ["ipea-expenses-v1"], { revalidate: 21_600 });

export async function tryGetExpenses(): Promise<{ data: ExpenseSummary | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
