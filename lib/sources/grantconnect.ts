// Commonwealth grant awards from GrantConnect's own "Grant Award Published"
// report, which the site offers as a public spreadsheet download (no login,
// capped at 50,000 rows per request). Data: GrantConnect, CC BY 3.0 AU.
// Report form: https://www.grants.gov.au/reports/gapublishedform
import { unstable_cache } from "next/cache";
import { readWorkbook, excelDate, USER_AGENT, type Row } from "../xlsx";

const DAY = 86_400_000;
export const GRANT_DEADLINE_DAYS = 21; // awards must be published within 21 days of the agreement taking effect

export type Grant = {
  id: string; // GA ID
  agency: string;
  recipient: string;
  recipientAbn: string | null;
  program: string;
  purpose: string;
  category: string;
  selection: string; // Open Competitive, Closed Non-Competitive, Demand Driven ...
  adHoc: boolean;
  value: number;
  published: string | null;
  start: string | null;
  end: string | null;
  deliveryState: string;
  // Days past the 21-day deadline, measured from the grant start date (the
  // closest published date to when the agreement took effect).
  lateDays: number | null;
};

type Bucket = { name: string; value: number; count: number };

export type GrantSummary = {
  from: string;
  to: string;
  count: number;
  totalValue: number;
  nonCompetitiveValue: number; // closed non-competitive, open non-competitive and ad hoc awards
  adHocValue: number;
  lateCount: number;
  knownStartCount: number;
  categories: (Bucket & { topAgency: string; topRecipient: string })[];
  selection: Bucket[];
  topAgencies: Bucket[];
  topRecipients: (Bucket & { abn: string | null })[];
  states: Bucket[];
  biggest: Grant[];
  reportUrl: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The report takes dates as 18-Sep-2026, in Canberra time.
function reportDate(d: Date) {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d).split("-");
  return `${day}-${MONTHS[Number(m) - 1]}-${y}`;
}

function toGrant(r: Row, col: Record<string, string>): Grant {
  const get = (name: string) => (r[col[name]] ?? "").trim();
  const published = excelDate(get("Publish Date"));
  const start = excelDate(get("Start Date"));
  let lateDays: number | null = null;
  if (published && start) lateDays = Math.floor((Date.parse(published) - Date.parse(start)) / DAY - GRANT_DEADLINE_DAYS);
  const abn = get("Recipient ABN");
  return {
    id: get("GA ID"),
    agency: get("Agency") || "Unknown agency",
    recipient: get("Recipient Name") || "Not published",
    recipientAbn: /^\d[\d ]+$/.test(abn) ? abn.replace(/ /g, "") : null,
    program: get("Grant Program"),
    purpose: get("Purpose"),
    category: get("Category") || "Not categorised",
    // One-off grants have no selection process, so the report leaves the field blank.
    selection: get("Selection Process") || (get("One-off/Ad hoc") === "Y" ? "One-off or ad hoc, no selection process" : "Not stated"),
    adHoc: get("One-off/Ad hoc") === "Y",
    value: Number(get("Value (AUD)")) || 0,
    published, start,
    end: excelDate(get("End Date")),
    deliveryState: get("Delivery State/Territory") || "Not stated",
    lateDays,
  };
}

function bump<T extends Bucket>(map: Map<string, T>, key: string, make: () => T, value: number) {
  const b = map.get(key) ?? make();
  b.value += value; b.count++; map.set(key, b);
  return b;
}
const top = <T extends Bucket>(map: Map<string, T>, n: number) =>
  [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);

async function load(days: number): Promise<GrantSummary> {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const query = new URLSearchParams({
    AgencyStatus: "0", DateType: "Publish Date", DateStart: reportDate(from), DateEnd: reportDate(to),
  }).toString().replace(/\+/g, "%20");

  const res = await fetch(`https://www.grants.gov.au/Reports/GaPublishedDownload?${query}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    cache: "no-store", // the spreadsheet is too big for the fetch cache; the summary below is cached instead
  });
  if (!res.ok) throw new Error(`GrantConnect returned ${res.status}`);
  const book = readWorkbook(Buffer.from(await res.arrayBuffer()));
  const rows = book.sheet(book.sheetNames[0]);

  // The sheet opens with a block describing the search; the table starts at the row holding "GA ID".
  const headAt = rows.findIndex((r) => Object.values(r).includes("GA ID"));
  if (headAt < 0) throw new Error("GrantConnect report has no GA ID column; the layout may have changed");
  const col = Object.fromEntries(Object.entries(rows[headAt]).map(([letter, name]) => [name.trim(), letter]));

  const seen = new Map<string, Grant>();
  for (const r of rows.slice(headAt + 1)) {
    const g = toGrant(r, col);
    if (g.id && !seen.has(g.id)) seen.set(g.id, g);
  }
  const grants = [...seen.values()];

  const cats = new Map<string, Bucket & { agencies: Map<string, Bucket>; recipients: Map<string, Bucket> }>();
  const selection = new Map<string, Bucket>();
  const agencies = new Map<string, Bucket>();
  const recipients = new Map<string, Bucket & { abn: string | null }>();
  const states = new Map<string, Bucket>();
  let totalValue = 0, nonCompetitiveValue = 0, adHocValue = 0, lateCount = 0, knownStart = 0;
  const blank = (name: string) => () => ({ name, value: 0, count: 0 });

  for (const g of grants) {
    totalValue += g.value;
    if (g.adHoc) adHocValue += g.value;
    if (g.adHoc || /non-competitive/i.test(g.selection)) nonCompetitiveValue += g.value;
    if (g.lateDays !== null) { knownStart++; if (g.lateDays > 0) lateCount++; }

    const c = bump(cats, g.category, () => ({ name: g.category, value: 0, count: 0, agencies: new Map(), recipients: new Map() }), g.value);
    bump(c.agencies, g.agency, blank(g.agency), g.value);
    bump(c.recipients, g.recipient, blank(g.recipient), g.value);
    bump(selection, g.selection, blank(g.selection), g.value);
    bump(agencies, g.agency, blank(g.agency), g.value);
    bump(recipients, g.recipientAbn ?? g.recipient, () => ({ name: g.recipient, abn: g.recipientAbn, value: 0, count: 0 }), g.value);
    bump(states, g.deliveryState, blank(g.deliveryState), g.value);
  }

  return {
    from: from.toISOString(), to: to.toISOString(),
    count: grants.length, totalValue, nonCompetitiveValue, adHocValue, lateCount, knownStartCount: knownStart,
    categories: top(cats, 15).map(({ agencies: a, recipients: r, ...c }) => ({
      ...c, topAgency: top(a, 1)[0]?.name ?? "", topRecipient: top(r, 1)[0]?.name ?? "",
    })),
    selection: top(selection, 8),
    topAgencies: top(agencies, 8),
    // "Not published" covers individuals and confidential recipients; it isn't one recipient.
    topRecipients: top(recipients, 12).filter((r) => r.name !== "Not published" && !/^n\/a$/i.test(r.name)).slice(0, 8),
    states: top(states, 10),
    biggest: [...grants].sort((a, b) => b.value - a.value).slice(0, 12),
    reportUrl: `https://www.grants.gov.au/Reports/GaPublishedShow?${query}`,
  };
}

// One download per range every six hours, shared by every page that needs it.
const cached = unstable_cache(load, ["grantconnect-summary-v2"], { revalidate: 21_600 });

export async function tryGetGrants(days: number): Promise<{ data: GrantSummary | null; error: string | null }> {
  try {
    return { data: await cached(days), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
