// Western Australia: no department publishes a list of grants awarded, and
// data.wa.gov.au has no grants dataset at all (checked 25 September 2026). The
// one body that does list every grant it approves is Lotterywest, the State's
// statutory lottery authority, which distributes lottery proceeds as community
// grants under the Lotteries Commission Act 1990. Its "grant recipients" page
// is drawn from a JSON endpoint on the same site, one row per approved grant:
// approval date, organisation, purpose, amount, region, whether the grantee
// agreed to publication, and whether the grant has since been acquitted.
//
// This is Lotterywest only. It is not the WA Government's departmental grants,
// and it excludes Lotterywest's statutory distributions to the health, sport
// and arts portfolios. The page shows grants approved "in the last year", so
// the window rolls forward: there is no earlier period to compare with.
import { parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { summarise, type StateGrant, type StateGrantRow, type StateGrantSummary, type StateGrantsLoad } from "./types";

const SITE = "https://www.lotterywest.wa.gov.au";
const PAGE_URL = `${SITE}/grants/grant-recipients`;
const API = `${SITE}/api/grants/approved`;
const PAGE_SIZE = 500; // the endpoint caps pageSize at 500
const MAX_PAGES = 10; // 568 grants in the year to July 2026; a runaway would stop here
const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };

// The published columns, keyed as the endpoint names them.
export const LOTTERYWEST_COLUMNS = ["date", "organisation", "purpose", "amount", "location", "publication choice", "state"] as const;

type ApiRow = Record<(typeof LOTTERYWEST_COLUMNS)[number], string>;
type ApiPage = { data: ApiRow[]; totalCount: number; totalPages: number; hasNextPage: boolean; page: number; pageSize: number };

async function readPage(page: number): Promise<ApiPage> {
  const url = `${API}?page=${page}&pageSize=${PAGE_SIZE}&sortBy=date&sortOrder=asc`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`lotterywest.wa.gov.au returned ${res.status} for page ${page} of the approved grants list`);
  const body = (await res.json()) as Partial<ApiPage>;
  if (!Array.isArray(body.data)) throw new Error("Lotterywest's approved grants endpoint no longer returns a data array");
  for (const r of body.data) {
    const missing = LOTTERYWEST_COLUMNS.filter((c) => typeof (r as any)[c] !== "string");
    if (missing.length > 0) throw new Error(`Lotterywest's approved grants list is missing columns: ${missing.join(", ")}`);
  }
  return body as ApiPage;
}

// Every grant on the page, oldest first: two requests at the current size.
async function readAll(): Promise<ApiRow[]> {
  const rows: ApiRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await readPage(page);
    rows.push(...p.data);
    if (!p.hasNextPage || p.data.length === 0) break;
  }
  if (rows.length === 0) throw new Error("Lotterywest's approved grants list is empty");
  return rows;
}

// 2026-07-30 -> FY2026-27
function financialYear(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(2)}`;
}

const LOCAL_GOVERNMENT = /^(city|shire|town) of /i;

// Uncached: the index caches the summary alone.
export async function loadWaGrants(): Promise<StateGrantsLoad> {
  const published = await readAll();

  const grants: StateGrant[] = [];
  const rows: StateGrantRow[] = [];
  const seen = new Map<string, number>();
  for (const r of published) {
    const value = parseMoney(r.amount);
    const date = parseAuDate(r.date);
    if (value === null || !date) continue;
    const year = financialYear(date);
    const fields: Record<string, string> = {};
    for (const c of LOTTERYWEST_COLUMNS) fields[c] = r[c];

    const recipient = r.organisation.trim();
    const grant: StateGrant = {
      agency: "Lotterywest",
      agencyCode: "LW",
      program: "", // the list carries no program or grant type
      subProgram: "",
      purpose: r.purpose.trim(),
      recipient: recipient || "Not published",
      recipientAbn: null, // not published
      pooled: false, // every line is one named organisation
      recipientType: LOCAL_GOVERNMENT.test(recipient) ? "Local government" : "",
      category: r.location.trim(), // Lotterywest's region: Perth Metropolitan, Kimberley, Statewide, ...
      assistance: "Grant",
      fundingSource: "Lotterywest", // lottery proceeds, not the Consolidated Account
      value,
      agreementTotal: null,
      start: date, // approval date
      end: null,
      deliveryLga: "",
    };
    grants.push(grant);
    // The list rolls forward and has no ids, so the grant's own facts are the key; a repeat of the
    // same organisation, date, amount and purpose gets a counter so it isn't lost.
    const key = `${date}|${recipient}|${value}|${grant.purpose}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    rows.push({ state: "WA", year, id: n === 1 ? key : `${key}|${n}`, programId: "", sourceUrl: API, value, grant, fields });
  }
  if (grants.length === 0) throw new Error("No Lotterywest grant had a readable amount and date");

  const dates = grants.map((g) => g.start!).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const words = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const summary = summarise(grants, {
    code: "WA", name: "Western Australia",
    subject: "approved by Lotterywest, Western Australia’s lottery authority, in community grants",
    // Not a financial year: the page shows the last year of approvals and rolls forward.
    year: `year to ${new Date(`${last}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`,
    period: `Lotterywest grants approved ${words(first)} to ${words(last)}`,
    coverage: `Every grant Lotterywest's board approved in the year to ${words(last)}, as listed on its grant recipients page: the organisation, what the grant is towards, the amount approved, the region and the approval date. Lotterywest only: it distributes lottery proceeds, not the State Budget, so this is not a list of grants from WA departments, and its statutory payments to the health, sport and arts portfolios are not grants and are not here. Grantees who asked not to be published are left out by Lotterywest. The value is the amount approved, not what has been paid; a grant marked acquitted has been paid and reported on. The list rolls forward a year at a time, so there is no earlier year to compare with.`,
    sourceName: "Lotterywest, grant recipients",
    sourceUrl: PAGE_URL,
    fileUrl: `${API}?page=1&pageSize=${PAGE_SIZE}&sortBy=date&sortOrder=asc`,
    licence: "© Lotterywest, all rights reserved (no open licence stated; published for general community information)",
    previous: null,
    unknownAgencyCodes: [],
  });
  return { summary, rows, replaceYears: false };
}
