// Every Commonwealth business the government has sold, from the Department of
// Finance's "Past sales" page: trade sales in $ million and public share offers
// in $ billion, each with the month of sale. The page is plain HTML with three
// tables; the third (scoping studies) is not a sale and is skipped.
import { unstable_cache } from "next/cache";
import { httpGet } from "./fuel/http";
import { governmentOn, type Government } from "../governments";
import { buyerFor, type Buyer } from "./asset-sale-buyers";

export const SALES_URL = "https://www.finance.gov.au/government/government-business-enterprises/past-sales";

export type AssetSale = {
  when: string; // as written, e.g. "May 1997" or "December 1998 - May 1999"
  year: number; // the year the sale finished
  month: string; // the month the sale finished, 1999-05
  name: string;
  kind: "trade sale" | "share offer";
  proceeds: number | null; // dollars; null where the page gives no figure
  note: string | null; // the page's qualifier, e.g. "plus annual lease payments"
  government: Government | null; // the government in office in the month the sale finished (lib/governments.ts)
  managedBy: string; // the Commonwealth unit that ran the sale, from the page's own history note
  buyer: Buyer | null; // hand-gathered with its source (asset-sale-buyers.ts); null for share offers and untraced sales
};

export type GovernmentTotal = { pm: string; party: Government["party"]; from: string; to: string | null; value: number; count: number; largest: AssetSale | null };

export type AssetSales = {
  sales: AssetSale[]; // oldest first
  total: number; // dollars, sales with a figure only
  byDecade: { decade: string; value: number; count: number }[];
  byGovernment: GovernmentTotal[]; // in office order, governments that sold something
  byParty: { party: Government["party"]; value: number; count: number }[];
  largest: AssetSale[];
  sourceUrl: string;
};

// Who ran the sales, from the page's own note: the Task Force on Asset Sales in Finance from 1987, the
// Office of Asset Sales (later OASITO, then OASACS) from 1996, and Finance again from December 2001.
function managedBy(month: string): string {
  if (month < "1996-03") return "Task Force on Asset Sales, Department of Finance";
  if (month < "2001-12") return "Office of Asset Sales (OASITO, later OASACS)";
  return "Department of Finance";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "December 1998 - May 1999" -> 1999-05; "October/November 1997" -> 1997-11; "June 2004" -> 2004-06.
function endMonth(when: string, year: number): string {
  const names = [...when.toLowerCase().matchAll(/[a-z]+/g)].map((m) => MONTHS.indexOf(m[0])).filter((i) => i >= 0);
  const last = names.length ? names[names.length - 1] + 1 : 6;
  return `${year}-${String(last).padStart(2, "0")}`;
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// "May 1997 Phase 1 Airports ..." -> when, year, name. Dates are a month (sometimes two) and a year, or a range.
const DATE = /^((?:[A-Z][a-z]+(?:\/[A-Z][a-z]+)?\s+)?\d{4}(?:\s*-\s*[A-Z][a-z]+\s+\d{4})?)\s+(.+)$/;

function parseRow(cells: string[], kind: AssetSale["kind"], scale: number): AssetSale | null {
  if (cells.length < 2) return null;
  const m = cells[0].match(DATE);
  if (!m) return null;
  const years = m[1].match(/\d{4}/g) ?? [];
  const amount = cells[1].match(/^\(?([\d,]+(?:\.\d+)?)/);
  const note = cells[1].replace(/^[\d,.]+\s*/, "").replace(/^\((.*)\)$/, "$1").trim() || null;
  const year = Number(years[years.length - 1]);
  const month = endMonth(m[1], year);
  return {
    when: m[1].replace(/\s*-\s*/, " to "), year, month, name: m[2], kind,
    proceeds: amount && !cells[1].startsWith("(") ? Number(amount[1].replace(/,/g, "")) * scale : null,
    note,
    government: governmentOn(month),
    managedBy: managedBy(month),
    buyer: kind === "trade sale" ? buyerFor({ year, name: m[2] }) : null,
  };
}

export function parseSales(html: string): AssetSale[] {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) => t[0]);
  const sales: AssetSale[] = [];
  for (const t of tables) {
    const caption = text(t.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? "");
    const kind = /trade sales/i.test(caption) ? "trade sale" : /share offers/i.test(caption) ? "share offer" : null;
    if (!kind) continue;
    const scale = /\(\$b\)/i.test(t) ? 1e9 : 1e6;
    for (const row of t.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
      const sale = parseRow(cells, kind, scale);
      if (sale) sales.push(sale);
    }
  }
  return sales.sort((a, b) => a.year - b.year);
}

// The page is a quarter of a megabyte, too big for Next's fetch cache, and an uncached fetch is refused
// inside the static build (it showed as "fetch failed" on the VM), so it is read with plain Node HTTPS and
// only the parsed list is cached, below.
async function load(): Promise<AssetSales> {
  const res = await httpGet(SALES_URL);
  if (res.status !== 200) throw new Error(`finance.gov.au returned ${res.status}`);
  const sales = parseSales(res.body);
  if (sales.length < 10) throw new Error(`Only ${sales.length} sales read from the Finance page; its layout may have changed`);

  const decades = new Map<string, { decade: string; value: number; count: number }>();
  for (const s of sales) {
    const decade = `${Math.floor(s.year / 10) * 10}s`;
    const d = decades.get(decade) ?? { decade, value: 0, count: 0 };
    d.value += s.proceeds ?? 0; d.count++;
    decades.set(decade, d);
  }
  // Consecutive sales under the same prime minister add up to one row, in office order.
  const governments: GovernmentTotal[] = [];
  const parties = new Map<Government["party"], { party: Government["party"]; value: number; count: number }>();
  for (const s of sales) {
    if (!s.government) continue;
    const g = s.government;
    let row = governments.find((r) => r.pm === g.pm && r.from === g.from);
    if (!row) { row = { pm: g.pm, party: g.party, from: g.from, to: g.to, value: 0, count: 0, largest: null }; governments.push(row); }
    row.value += s.proceeds ?? 0; row.count++;
    if (s.proceeds !== null && (row.largest === null || s.proceeds > (row.largest.proceeds ?? 0))) row.largest = s;
    const p = parties.get(g.party) ?? { party: g.party, value: 0, count: 0 };
    p.value += s.proceeds ?? 0; p.count++; parties.set(g.party, p);
  }
  return {
    sales,
    total: sales.reduce((sum, s) => sum + (s.proceeds ?? 0), 0),
    byDecade: [...decades.values()],
    byGovernment: governments.sort((a, b) => a.from.localeCompare(b.from)),
    byParty: [...parties.values()].sort((a, b) => b.value - a.value),
    largest: [...sales].filter((s) => s.proceeds !== null).sort((a, b) => b.proceeds! - a.proceeds!).slice(0, 5),
    sourceUrl: SALES_URL,
  };
}

// The list changes only when the Commonwealth sells something, so a daily read is plenty.
export const getAssetSales = unstable_cache(load, ["finance-past-sales-v4"], { revalidate: 86_400 });

export async function tryGetAssetSales(): Promise<{ data: AssetSales | null; error: string | null }> {
  try {
    return { data: await getAssetSales(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
