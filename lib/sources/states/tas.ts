// Tasmania: no dataset or export exists. The tenders site lists contracts
// awarded in the last 30 days, and each contract's page gives the value and
// supplier. This reads that list and its pages once a day, three at a time.
// https://www.tenders.tas.gov.au/ContractAwarded/List/DateAwarded
import { parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { summarise, type StateContract, type StateSummary } from "./types";

const SITE = "https://www.tenders.tas.gov.au";
const LIST = `${SITE}/ContractAwarded/List/DateAwarded`;

async function page(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`tenders.tas.gov.au returned ${res.status}`);
  return res.text();
}

// Page text as "label | value | label | value", which is how the detail table reads once tags are stripped.
const cells = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "|").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").split("|").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);

function readDetail(id: string, html: string): StateContract | null {
  const all = cells(html);
  // The site menu above the contract repeats words like "Agency", so start at the contract's own heading.
  const c = all.slice(Math.max(0, all.findIndex((x) => /^Procurement Title$/i.test(x))));
  const after = (label: RegExp) => { const i = c.findIndex((x) => label.test(x)); return i >= 0 ? c[i + 1] ?? "" : ""; };
  const value = parseMoney((after(/^Total Contract Value$/i).match(/\$[\d,]+(\.\d+)?/) ?? [""])[0]);
  const awarded = parseAuDate(after(/^Awarded Date$/i));
  if (value === null || value <= 0 || !awarded) return null;
  // The supplier table's first data cell follows its last heading, "Allocated Amount".
  const suppliers = c.filter((_, i) => i > 0 && /^Allocated Amount$/i.test(c[i - 1]));
  const amounts = c.filter((x, i) => /^\$[\d,]+/.test(x) && i < c.findIndex((y) => /^Total Contract Value$/i.test(y)));
  return {
    id: after(/^Unique Tender ID$/i) || id, value, awarded,
    agency: after(/^Agency$/i) || "Unknown agency",
    supplier: amounts.length > 1 ? "Several suppliers" : suppliers[0] || "Not published",
    supplierAbn: null,
    description: after(/^Procurement Title$/i),
    method: after(/^Type\/Procurement Method$/i),
    category: after(/^UNSPSC Category$/i) || null,
  };
}

export async function loadTas(): Promise<StateSummary> {
  const ids = [...new Set([...(await page(LIST)).matchAll(/\/ContractAwarded\/Details\/(\d+)/g)].map((m) => m[1]))];
  if (ids.length === 0) throw new Error("No awarded contracts found on the Tasmanian tenders list; the page may have changed");

  const contracts: StateContract[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const c = readDetail(id, await page(`${SITE}/ContractAwarded/Details/${id}`));
        if (c) contracts.push(c); else skipped.push({ name: `Contract page ${id}`, reason: "no value or award date on the page" });
      } catch (e) {
        skipped.push({ name: `Contract page ${id}`, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }));

  return summarise(contracts, {
    code: "TAS", name: "Tasmania", noun: "contracts",
    period: "Awarded in the last 30 days",
    coverage: "Tasmania only lists the last 30 days of awarded contracts and offers no download, so this is a rolling month read from the tenders site’s own pages. Values are often marked as estimates.",
    sourceName: "Tasmanian Government Tenders, awarded contracts",
    sourceUrl: LIST, licence: "Tasmanian Government copyright, shown with attribution",
    filesRead: contracts.length, filesSkipped: skipped,
  });
}
