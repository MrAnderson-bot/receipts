// Northern Territory: the tenders site's own "export search results" button
// returns every awarded contract since 2012 as one spreadsheet. The NT open
// data portal lists this register as its awarded-contracts dataset (CC BY).
// https://data.nt.gov.au/dataset/awarded-government-contracts
import { parseMoney, parseAuDate } from "../../csv";
import { readWorkbook, USER_AGENT } from "../../xlsx";
import { summarise, type StateContract, type StateSummary } from "./types";

const EXPORT = "https://tendersonline.nt.gov.au/Tender/ExportTenderers?status=Awarded";
const DAY = 86_400_000;
const WINDOW_DAYS = 365;

export async function loadNt(): Promise<StateSummary> {
  // Without a date the site rebuilds the whole register back to 2012, which takes about two minutes.
  // It only honours the filter as an ISO date; dd/mm/yyyy is silently ignored.
  const from = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const res = await fetch(`${EXPORT}&awardedDateFrom=${from}`, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`tendersonline.nt.gov.au returned ${res.status}`);
  const book = readWorkbook(Buffer.from(await res.arrayBuffer()));
  const rows = book.sheet(book.sheetNames[0]);
  const col = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([letter, name]) => [name.trim(), letter]));
  const get = (r: Record<string, string>, name: string) => {
    const v = (r[col[name]] ?? "").trim();
    return /^information not available$/i.test(v) ? "" : v;
  };

  const cutoff = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  // One row per winning tenderer, each with its own amount, so rows are added up rather than deduplicated.
  const contracts: StateContract[] = [];
  for (const r of rows.slice(1)) {
    const value = parseMoney(get(r, "Amount"));
    const awarded = parseAuDate(get(r, "Tender Award Date"));
    if (value === null || value <= 0 || !awarded || awarded < cutoff) continue;
    const abn = get(r, "Awarded Tenderer ABN").replace(/\s/g, "");
    contracts.push({
      id: get(r, "Tender Number"), value, awarded,
      agency: get(r, "Agency") || "Unknown agency",
      supplier: get(r, "Awarded Tenderer") || "Not published",
      supplierAbn: /^\d{11}$/.test(abn) ? abn : null,
      description: get(r, "Title"),
      method: get(r, "Procurement Method"),
      category: get(r, "Category") || null,
    });
  }

  return summarise(contracts, {
    code: "NT", name: "Northern Territory", noun: "contracts",
    period: "Awarded in the last 12 months",
    coverage: "Every tender awarded through the NT Government’s tenders site. A tender split between several suppliers appears once per supplier, each with its own amount.",
    sourceName: "NT awarded government contracts",
    sourceUrl: "https://data.nt.gov.au/dataset/awarded-government-contracts", licence: "CC BY 4.0",
    filesRead: 1, filesSkipped: [],
  });
}
