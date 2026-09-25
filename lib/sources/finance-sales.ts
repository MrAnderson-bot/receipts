// Every Commonwealth business the government has sold, from the Department of
// Finance's "Past sales" page: trade sales in $ million and public share offers
// in $ billion, each with the month of sale. The page is plain HTML with three
// tables; the third (scoping studies) is not a sale and is skipped.
import { unstable_cache } from "next/cache";
import { USER_AGENT } from "../xlsx";

export const SALES_URL = "https://www.finance.gov.au/government/government-business-enterprises/past-sales";

export type AssetSale = {
  when: string; // as written, e.g. "May 1997" or "December 1998 - May 1999"
  year: number; // the year the sale finished
  name: string;
  kind: "trade sale" | "share offer";
  proceeds: number | null; // dollars; null where the page gives no figure
  note: string | null; // the page's qualifier, e.g. "plus annual lease payments"
};

export type AssetSales = {
  sales: AssetSale[]; // oldest first
  total: number; // dollars, sales with a figure only
  byDecade: { decade: string; value: number; count: number }[];
  largest: AssetSale[];
  sourceUrl: string;
};

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
  return {
    when: m[1].replace(/\s*-\s*/, " to "), year: Number(years[years.length - 1]), name: m[2], kind,
    proceeds: amount && !cells[1].startsWith("(") ? Number(amount[1].replace(/,/g, "")) * scale : null,
    note,
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

// The page is a quarter of a megabyte, too big for Next's fetch cache (which overflows the stack storing it),
// so the download is not cached and the parsed list is, below.
async function load(): Promise<AssetSales> {
  const res = await fetch(SALES_URL, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`finance.gov.au returned ${res.status}`);
  const sales = parseSales(await res.text());
  if (sales.length < 10) throw new Error(`Only ${sales.length} sales read from the Finance page; its layout may have changed`);

  const decades = new Map<string, { decade: string; value: number; count: number }>();
  for (const s of sales) {
    const decade = `${Math.floor(s.year / 10) * 10}s`;
    const d = decades.get(decade) ?? { decade, value: 0, count: 0 };
    d.value += s.proceeds ?? 0; d.count++;
    decades.set(decade, d);
  }
  return {
    sales,
    total: sales.reduce((sum, s) => sum + (s.proceeds ?? 0), 0),
    byDecade: [...decades.values()],
    largest: [...sales].filter((s) => s.proceeds !== null).sort((a, b) => b.proceeds! - a.proceeds!).slice(0, 5),
    sourceUrl: SALES_URL,
  };
}

// The list changes only when the Commonwealth sells something, so a daily read is plenty.
export const getAssetSales = unstable_cache(load, ["finance-past-sales"], { revalidate: 86_400 });

export async function tryGetAssetSales(): Promise<{ data: AssetSales | null; error: string | null }> {
  try {
    return { data: await getAssetSales(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
