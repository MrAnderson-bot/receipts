// New South Wales: the Grants and Funding Finder on nsw.gov.au is the register.
// The Grants Administration Guide makes every agency publish each award on the
// grant's own finder page within 45 days, and the finder keeps those awards as
// structured records behind a public GraphQL API (the "Most recent recipients"
// block on a grant page is drawn from it). There is no whole-of-government file,
// so this module enumerates every grant in the finder's search index, asks the
// API which grants have awards and what they add up to, and pages out the
// awards of the grants whose figures changed since the database last saw them.
// Roughly 950 of the 1,900 grants carry awards: about 52,000 lines and $13bn
// since September 2022.
//
// Two endpoints, both public and unauthenticated:
//   POST /api/v1/elasticsearch/prod_content/_search  type:grant -> every grant page (nid, title, agency)
//   POST /graphql   content(id: nid) { ... on Grant { applications(type: "GrantAwarded") } }
// The GraphQL endpoint caps a query at complexity 50 (16 two-field aliases fit)
// and a page of awards at 100, and refuses introspection, so the queries below
// are the finder's own, copied from grant-recipients.entry.js.
//
// Rate: the site sits behind CloudFront with a rate rule. Three readers at once
// with 300 ms pauses were blocked outright after five minutes on 25 September
// 2026 (a 403 on every request for some time afterwards), while one reader at
// one to three requests a second was never refused. So: one reader, a pause
// between requests, and a nightly budget of grants to re-read, so a full pass is
// the summary scan (about 120 requests) plus a few hundred award pages at most.
import { USER_AGENT } from "../../xlsx";
import type { Store } from "../../db/types";
import { summarise, type StateGrant, type StateGrantRow, type StateGrantSummary } from "./types";

const SITE = "https://www.nsw.gov.au";
const SEARCH = `${SITE}/api/v1/elasticsearch/prod_content/_search`;
const GRAPHQL = `${SITE}/graphql`;
const FINDER_URL = `${SITE}/grants-and-funding`;
const headers = { "User-Agent": USER_AGENT, "Content-Type": "application/json" };

// One line per award, keyed by the headings the finder's own "download CSV"
// button writes, plus the API fields that button leaves out.
export const NSW_COLUMNS = [
  "Grant ID", "Grant", "Grant URL", "Administered by", "Funded by", "Award ID", "Date", "Recipient", "Project",
  "Project description", "Amount awarded", "Decision maker", "Intended decision maker", "Actual decision maker",
  "Was ministerial discretion applied?", "Reason for ministerial discretion", "Reason for different decision maker",
  "Number of applicants", "Number of recipients", "Program benefit-cost ratio", "Program term",
  "Location of the recipient", "Location of the project", "Grant category", "Grant audience",
] as const;

type GrantPage = { nid: number; title: string; url: string; agency: string; categories: string[]; audiences: string[] };
type Term = { label: string };
type Award = {
  id: number; amount: number | null; date: string | null; label: string | null; project_name: string | null;
  actual_decision_maker: string | null; intended_decision_maker: string | null; reason_minister_discretion: string | null;
  reason_different_decision_maker: string | null; number_of_applicants: number | null; number_of_recipients: number | null;
  program_benefit_cost_ratio: number | null; program_term: string | null; project_description: string | null;
  program_delivery_location: Term[] | null; region: Term[] | null;
};
type GrantAwards = {
  id: number; label: string; url: string; number_of_recipients: number; total_funds_dispersed: number;
  agency: Term[] | null; agency_funding: Term[] | null; applications: Award[] | null;
};

const PAGE = 100; // the API's cap on applications(size)
const ALIASES = 16; // two-field aliases per summary query, under the complexity cap of 50
const PAUSE = 500; // ms between requests: one reader, two a second at most
export const NSW_BUDGET_DEFAULT = 250; // grants re-read a night: about 350 requests, a few minutes
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One retry, never a loop. A refusal (403 or 429) is CloudFront's rate rule: wait
// well clear of its window once, and if it holds, surface it and stop for the night.
// A server error (5xx) is transient on this site and gets one short pause.
async function post(url: string, body: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
    if (res.ok) return res.json();
    const refused = res.status === 403 || res.status === 429;
    if (attempt >= 1 || (!refused && res.status < 500)) throw new Error(`nsw.gov.au returned ${res.status}`);
    await sleep(refused ? 5 * 60_000 : 5_000);
  }
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const d = await post(GRAPHQL, { query, variables });
  if (d.errors?.length && !d.data) throw new Error(`nsw.gov.au GraphQL: ${d.errors[0]?.message ?? "error"}`);
  return d.data ?? {};
}

// Every grant page in the finder, from its search index, in node-id order.
async function listGrants(): Promise<GrantPage[]> {
  const grants: GrantPage[] = [];
  for (let from = 0; ; from += 1000) {
    const d = await post(SEARCH, {
      from, size: 1000, sort: [{ nid: "asc" }],
      _source: ["nid", "title", "url", "agency_name", "grant_category", "grant_audience"],
      query: { bool: { filter: [{ term: { type: "grant" } }] } },
    });
    const hits: any[] = d.hits?.hits ?? [];
    for (const h of hits) {
      const s = h._source ?? {};
      grants.push({
        nid: Number(s.nid?.[0]), title: String(s.title?.[0] ?? ""), url: String(s.url?.[0] ?? ""),
        agency: String(s.agency_name?.[0] ?? ""), categories: s.grant_category ?? [], audiences: s.grant_audience ?? [],
      });
    }
    if (hits.length < 1000) break;
    await sleep(PAUSE);
  }
  if (grants.length === 0) throw new Error("The nsw.gov.au grants index returned no grants");
  return grants.filter((g) => Number.isFinite(g.nid));
}

export type GrantFigures = GrantPage & { recipients: number; total: number };

// Each grant's published recipient count and total, 16 grants a query: the cheap
// pass that says which grants have changed since the database last read them.
async function scanGrants(grants: GrantPage[]): Promise<GrantFigures[]> {
  const out: GrantFigures[] = [];
  for (let i = 0; i < grants.length; i += ALIASES) {
    const batch = grants.slice(i, i + ALIASES);
    const q = `{ ${batch.map((g) => `g${g.nid}: content(id: ${g.nid}) { ... on Grant { number_of_recipients total_funds_dispersed } }`).join(" ")} }`;
    const d = await gql(q);
    for (const g of batch) {
      const r = d[`g${g.nid}`];
      const recipients = Number(r?.number_of_recipients ?? 0), total = Number(r?.total_funds_dispersed ?? 0);
      if (recipients > 0) out.push({ ...g, recipients, total });
    }
    await sleep(PAUSE);
  }
  return out;
}

const AWARDS_QUERY = `query Q($grantId: Int!, $offset: Int!, $size: Int!) { content(id: $grantId) { ... on Grant {
  id label url number_of_recipients total_funds_dispersed agency { label } agency_funding { label }
  applications(type: "GrantAwarded", offset: $offset, size: $size) { ... on GrantAwarded {
    id amount date label project_name actual_decision_maker intended_decision_maker reason_minister_discretion
    reason_different_decision_maker number_of_applicants number_of_recipients program_benefit_cost_ratio program_term
    project_description program_delivery_location { label } region { label } } } } } }`;

// An award whose amount the API cannot serve (a handful are stored as text it
// can't cast) comes back as null in the list with an "Internal server error"
// for that one field. Those are counted and left out; the rest of the page is fine.
async function readAwards(nid: number): Promise<{ grant: GrantAwards | null; awards: Award[]; unreadable: number }> {
  const awards: Award[] = [];
  let grant: GrantAwards | null = null, unreadable = 0;
  for (let offset = 0; ; offset += PAGE) {
    const d = await gql(AWARDS_QUERY, { grantId: nid, offset, size: PAGE });
    const c: GrantAwards | null = d.content ?? null;
    if (!c) break;
    grant = c;
    const page: (Award | null)[] = c.applications ?? [];
    for (const a of page) { if (a) awards.push(a); else unreadable++; }
    await sleep(PAUSE);
    if (page.length < PAGE) break;
  }
  return { grant, awards, unreadable };
}

const labels = (t: Term[] | null | undefined) => (t ?? []).map((x) => x.label).filter(Boolean).join(", ");
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// Recipients withheld for privacy are pooled by the publisher: "Name removed for
// privacy reasons", or a round label ending "(N Recipients)" that aggregates every
// recipient in an LGA with five or fewer.
const pooledLabel = (label: string) =>
  /removed|withheld|privacy|confidential|^(multiple|various|undisclosed)/i.test(label) || /\(\d+ recipients?\)\s*$/i.test(label) || !label.trim();

// The financial year an award date falls in: 2025-09-01 -> FY2025-26.
function financialYear(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), start = Number(m[2]) >= 7 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(2)}`;
}

function toRow(page: GrantPage, g: GrantAwards, a: Award): StateGrantRow | null {
  const value = typeof a.amount === "number" && Number.isFinite(a.amount) ? a.amount : null;
  if (value === null) return null;
  const year = financialYear(a.date);
  if (!year) return null;
  const recipient = (a.label ?? "").trim();
  const administered = labels(g.agency) || page.agency;
  const funded = labels(g.agency_funding) || administered;
  const url = `${SITE}${g.url || page.url}`;
  const fields: Record<string, string> = {
    "Grant ID": String(g.id), "Grant": g.label || page.title, "Grant URL": url, "Administered by": administered, "Funded by": funded,
    "Award ID": text(a.id), "Date": text(a.date), "Recipient": recipient, "Project": text(a.project_name),
    "Project description": text(a.project_description), "Amount awarded": String(value),
    "Decision maker": text(a.actual_decision_maker || a.intended_decision_maker),
    "Intended decision maker": text(a.intended_decision_maker), "Actual decision maker": text(a.actual_decision_maker),
    "Was ministerial discretion applied?": a.reason_minister_discretion ? "Yes" : "No",
    "Reason for ministerial discretion": text(a.reason_minister_discretion),
    "Reason for different decision maker": text(a.reason_different_decision_maker),
    "Number of applicants": text(a.number_of_applicants), "Number of recipients": text(a.number_of_recipients),
    "Program benefit-cost ratio": text(a.program_benefit_cost_ratio), "Program term": text(a.program_term),
    "Location of the recipient": labels(a.region), "Location of the project": labels(a.program_delivery_location),
    "Grant category": page.categories.join(", "), "Grant audience": page.audiences.join(", "),
  };
  const grant: StateGrant = {
    agency: funded,
    agencyCode: "",
    program: g.label || page.title,
    subProgram: "",
    purpose: text(a.project_name) || text(a.project_description),
    recipient: recipient || "Not published",
    recipientAbn: null,
    pooled: pooledLabel(recipient),
    recipientType: "",
    category: page.categories.join(", "),
    assistance: "Grant",
    fundingSource: "",
    value,
    agreementTotal: null,
    start: a.date,
    end: null,
    deliveryLga: labels(a.region),
  };
  // The award's own content id is the stable key; the grant's node id in front keeps it readable.
  return { state: "NSW", year, id: `${g.id}|${a.id}`, programId: String(g.id), sourceUrl: url, value, grant, fields };
}

export type NswScan = { grants: number; withAwards: GrantFigures[] };

// The cheap pass: every grant in the finder and, for those with awards, the published count and total.
export async function scanNsw(): Promise<NswScan> {
  const pages = await listGrants();
  await sleep(PAUSE);
  return { grants: pages.length, withAwards: await scanGrants(pages) };
}

// The summary the page shows, built from every stored award. The register is
// cumulative: the featured year is the last full financial year, the year before
// it gives the change, and awards in the current, partial year stay in the rows.
export function summariseNsw(rows: StateGrantRow[], scan: NswScan, pending: number, unreadable: number): StateGrantSummary {
  const byYear = new Map<string, StateGrantRow[]>();
  for (const r of rows) (byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)!).push(r);
  const years = [...byYear.keys()].sort().reverse();
  const current = financialYear(new Date().toISOString())!;
  const featured = years.find((y) => y < current) ?? years[0] ?? current;
  const featuredRows = byYear.get(featured) ?? [];
  const prevYear = years.find((y) => y < featured);
  const prevRows = prevYear ? byYear.get(prevYear) ?? [] : [];
  const previous = prevYear ? { year: prevYear, count: prevRows.length, totalValue: prevRows.reduce((s, r) => s + r.value, 0) } : null;
  const label = featured.slice(2);
  const read = scan.withAwards.length - pending;
  return summarise(featuredRows.map((r) => r.grant), {
    code: "NSW", name: "New South Wales", year: featured,
    subject: "awarded by NSW government agencies in grants published on the Grants and Funding Finder",
    period: `Financial year ${label}, by date approved`,
    coverage: `Every award published on the NSW Grants and Funding Finder with a decision date in ${label}. ${scan.withAwards.length} of the finder's ${scan.grants} grant programs list their recipients, as the Grants Administration Guide requires within 45 days of a decision${pending > 0 ? `; ${read} of them have been read so far and the rest follow over the next nights, a few hundred a night, to stay within the site's rate limit` : ""}. The value is the amount awarded, not what has been paid. Recipients who are individuals, or fewer than six in one council area, are pooled under “Name removed for privacy reasons” or a round total. Grants delivered outside the finder, and awards agencies have not yet published, are not here.${unreadable > 0 ? ` ${unreadable} published awards whose amount the finder's API cannot serve are left out.` : ""}`,
    sourceName: "NSW Government Grants and Funding Finder, published grant recipients",
    sourceUrl: FINDER_URL,
    fileUrl: FINDER_URL,
    licence: "CC BY 4.0",
    previous,
    unknownAgencyCodes: [],
  });
}

// The nightly job: scan, re-read the grants whose published figures differ from
// what is stored (new grants first, then changed ones), up to the budget, save
// them with the grant's stale rows removed, then summarise everything stored.
export async function snapshotNsw(store: Store, budget: number): Promise<{ summary: StateGrantSummary; detail: string }> {
  const scan = await scanNsw();
  const stored = new Map((await store.stateGrantPrograms("NSW")).map((p) => [p.programId, p]));
  const changed = scan.withAwards.filter((g) => {
    const s = stored.get(String(g.nid));
    return !s || s.count !== g.recipients || Math.round(s.total) !== Math.round(g.total);
  });
  // Amounts the API can't serve keep a grant's stored total below its published one for ever;
  // reading those again every night would waste the budget, so grants already read come last.
  changed.sort((a, b) => Number(stored.has(String(a.nid))) - Number(stored.has(String(b.nid))) || a.nid - b.nid);
  const todo = changed.slice(0, budget);

  const rows: StateGrantRow[] = [];
  let unreadable = 0, programs: string[] = [];
  for (const page of todo) {
    const { grant, awards, unreadable: u } = await readAwards(page.nid);
    unreadable += u;
    if (!grant) continue;
    programs.push(String(grant.id));
    for (const a of [...awards].sort((x, y) => x.id - y.id)) {
      const row = toRow(page, grant, a);
      if (row) rows.push(row);
    }
  }
  const saved = programs.length > 0 ? await store.saveStateGrants(rows, { programs }) : { added: 0, removed: 0 };

  const all = await store.stateGrantRows("NSW");
  const pending = changed.length - todo.length;
  const summary = summariseNsw(all, scan, pending, unreadable);
  const detail = `${scan.withAwards.length} grants with awards, ${todo.length} read (${rows.length} lines, ${saved.added} new, ${saved.removed} gone)` +
    `${pending ? `, ${pending} still to read` : ""}${unreadable ? `, ${unreadable} amounts unreadable` : ""}; ${all.length} lines stored, featuring ${summary.year}`;
  return { summary, detail };
}
