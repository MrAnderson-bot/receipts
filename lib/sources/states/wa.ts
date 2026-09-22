// Western Australia: Tenders WA publishes every awarded contract as one CSV per
// financial year on data.wa.gov.au (CC BY 4.0).
import { parseCsv, parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { categoryOf, summarise, type StateContract, type StateSummary } from "./types";

const CKAN = "https://catalogue.data.wa.gov.au/api/3/action";

export async function loadWa(): Promise<StateSummary> {
  const headers = { "User-Agent": USER_AGENT };
  const search = await fetch(
    `${CKAN}/package_search?q=${encodeURIComponent('title:"Tenders WA Contract Award Details"')}&rows=20`,
    { headers, cache: "no-store" });
  if (!search.ok) throw new Error(`data.wa.gov.au returned ${search.status}`);
  // One dataset per financial year; the title carries the year, so the highest title is the newest.
  const datasets: any[] = ((await search.json()).result?.results ?? [])
    .filter((d: any) => /\d{4}-\d{2}/.test(d.title))
    .sort((a: any, b: any) => b.title.match(/\d{4}-\d{2}/)[0].localeCompare(a.title.match(/\d{4}-\d{2}/)[0]));
  const dataset = datasets[0];
  const url = dataset?.resources.find((r: any) => /csv/i.test(r.format))?.url;
  if (!url) throw new Error("No Tenders WA award file found on data.wa.gov.au");
  const year = dataset.title.match(/\d{4}-\d{2}/)[0];

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.wa.gov.au returned ${res.status} for the ${year} award file`);
  const rows = parseCsv(await res.text());
  const col = Object.fromEntries(rows[0].map((name, i) => [name, i]));
  const get = (r: string[], name: string) => r[col[name]] ?? "";

  // A panel contract appears once per supplier with the full value on every row,
  // so only the first row for each reference number is counted.
  const seen = new Map<string, StateContract>();
  for (const r of rows.slice(1)) {
    const id = get(r, "Reference_Number");
    const value = parseMoney(get(r, "Original_Contract_Value"));
    const awarded = parseAuDate(get(r, "Award_Date"));
    if (!id || value === null || value <= 0 || !awarded) continue;
    const existing = seen.get(id);
    if (existing) { existing.supplier = "Several suppliers (panel)"; continue; }
    seen.set(id, {
      id, value, awarded,
      // Tenders WA tags renamed agencies "(NOT IN USE)"; the name itself is still right for the contract.
      agency: get(r, "Public_Authority").replace(/\s*\(NOT IN USE\)/i, "") || "Unknown agency",
      supplier: get(r, "Supplier_Name") || "Not published",
      supplierAbn: null,
      description: get(r, "Title"),
      method: get(r, "Procurement_Method"),
      category: categoryOf(get(r, "UNSPSC_Code_1")),
    });
  }

  return summarise([...seen.values()], {
    code: "WA", name: "Western Australia", noun: "contracts",
    period: `Financial year ${year}`,
    coverage: `Contracts awarded by WA public authorities in ${year}, the most recent year Tenders WA has released as open data. Values are the original contract value, often an estimate. Panel contracts are counted once.`,
    sourceName: dataset.title,
    sourceUrl: `https://catalogue.data.wa.gov.au/dataset/${dataset.name}`,
    licence: "CC BY 4.0",
    filesRead: 1, filesSkipped: [],
  });
}
