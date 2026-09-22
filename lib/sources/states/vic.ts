// Victoria: the Buying for Victoria register is public but only opens in a web
// browser, has no export and isn't on data.vic.gov.au. So this is not a feed. It
// reads a snapshot in data/states/vic.txt that was gathered by reading the
// register in a browser, and it goes stale until someone refreshes that file.
// https://www.tenders.vic.gov.au/contract/search
import { readFile } from "fs/promises";
import path from "path";
import { parseAuDate } from "../../csv";
import { summarise, type StateContract, type StateSummary } from "./types";

const FILE = path.join(process.cwd(), "data", "states", "vic.txt");

// Line 1: "# captured=2026-09-19 startFrom=2025-09-19 minValue=5000000"
// Then one contract per line, fields separated by " | ": id, number, title, start date, value, public body, type, UNSPSC title, supplier, ABN
export async function loadVic(): Promise<StateSummary> {
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch {
    throw new Error("No Victorian snapshot has been captured yet (data/states/vic.txt is missing).");
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const meta = Object.fromEntries([...lines[0].matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));

  const contracts: StateContract[] = [];
  for (const line of lines.slice(1)) {
    const [id, number, title, start, value, body, type, unspsc, supplier, abn] = line.split("|").map((c) => c.trim());
    const awarded = parseAuDate((start ?? "").replace(/\bSept\b/, "Sep").replace(/\bJuly\b/, "Jul").replace(/\bJune\b/, "Jun"));
    if (!id || !Number(value) || !awarded) continue;
    // Homes Victoria files a month of building contracts as one entry and names its own department as the supplier.
    const selfSupplied = !!supplier && (body ?? "").toLowerCase().includes(supplier.toLowerCase());
    contracts.push({
      id: number || id, value: Number(value), awarded,
      agency: body || "Not captured",
      supplier: selfSupplied ? "Not published (bundled by the agency)" : supplier || "Not published",
      supplierAbn: !selfSupplied && /^\d{11}$/.test(abn ?? "") ? abn : null,
      description: title ?? "",
      method: "", // the register doesn't show how the contract was awarded
      category: unspsc || type || null,
    });
  }

  const money = `$${(Number(meta.minValue ?? 0) / 1e6).toLocaleString("en-AU")} million`;
  const day = (iso: string | undefined) =>
    iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "an unknown date";
  return summarise(contracts, {
    code: "VIC", name: "Victoria", noun: "contracts",
    period: `Starting on or after ${day(meta.startFrom)}, snapshot taken ${day(meta.captured)}`,
    coverage: `Only contracts of ${money} and over. Victoria’s register has no download and only opens in a web browser, so this is a snapshot read from the register by hand, not a live feed, and smaller contracts are not included. Dates shown are contract start dates.`,
    sourceName: "Buying for Victoria contracts register",
    sourceUrl: "https://www.tenders.vic.gov.au/contract/search", licence: "State of Victoria copyright, shown with attribution",
    filesRead: 1, filesSkipped: [],
  });
}
