// Commonwealth general government expenses by purpose, actuals, from the ABS annual release
// "Government Finance Statistics, Annual" (cat. 5512.0, CC BY 4.0). The Budget's own expenses-by-function
// table is estimates only; this is the audited outcome by purpose (COFOG-A: defence, health, education,
// social protection and so on), which the Budget page can only get from here.
//
// Each release carries ten financial years in data cube 55120DO002 ("Table 130. General government -
// Commonwealth"), sheet Table_4 "Commonwealth General Government Expenses by Purpose". Older releases
// carry earlier ten-year windows, so the backfill reads one release per unit (docs/backfill.md).
import { readWorkbook, USER_AGENT, type Row } from "../xlsx";
import type { Series } from "./types";

const RELEASES = "https://www.abs.gov.au/statistics/economy/government/government-finance-statistics-annual";

export type GfsExpenses = {
  releaseYear: string; // the financial year the release is for, e.g. 2024-25
  releaseUrl: string;
  workbookUrl: string;
  years: string[]; // financial years the table covers, oldest first
  purposes: { name: string; parent: string | null; series: Series }[]; // in the table's order; sub-purposes carry their parent
  total: Series;
};

// The release page for a financial year ("2024-25"), or the latest release when none is given.
export const releaseUrl = (year?: string) => `${RELEASES}/${year ?? "latest-release"}`;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function loadGfsExpenses(year?: string): Promise<GfsExpenses> {
  const headers = { "User-Agent": USER_AGENT };
  const page = await fetch(releaseUrl(year), { headers, cache: "no-store" });
  if (!page.ok) throw new Error(`ABS returned ${page.status} for the Government Finance Statistics release${year ? ` ${year}` : ""}`);
  const html = await page.text();
  const href = html.match(/href="([^"]*55120DO002_\d+\.xlsx)"/i)?.[1];
  if (!href) throw new Error(`No 55120DO002 data cube (Commonwealth general government) on the ABS release page${year ? ` for ${year}` : ""}`);
  const workbookUrl = new URL(href, RELEASES).toString();
  const releaseYear = year ?? (html.match(/Government Finance Statistics, Annual, (\d{4}-\d{2}) financial year/)?.[1] ?? workbookUrl.match(/_(\d{4})(\d{2})\.xlsx$/)?.slice(1).join("-") ?? "");

  const res = await fetch(workbookUrl, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`ABS returned ${res.status} for ${workbookUrl}`);
  const book = readWorkbook(Buffer.from(await res.arrayBuffer()));
  const sheetName = book.sheetNames.find((n) => {
    const rows = book.sheet(n);
    return rows.some((r) => /expenses by purpose/i.test(String(r.A ?? "")));
  });
  if (!sheetName) throw new Error("The Commonwealth general government cube has no 'Expenses by Purpose' table; the layout may have changed");
  const rows = book.sheet(sheetName);

  const yearRow = rows.find((r) => Object.values(r).filter((v) => /^\d{4}-\d{2}$/.test(String(v).trim())).length >= 3);
  if (!yearRow) throw new Error("The expenses-by-purpose table has no row of financial years");
  const cols = Object.entries(yearRow).filter(([, v]) => /^\d{4}-\d{2}$/.test(String(v).trim())).map(([c, v]) => [c, String(v).trim()] as const);
  const years = cols.map(([, y]) => y);
  const points = (r: Row) => cols.flatMap(([c, y]) => {
    const v = Number(String(r[c] ?? "").replace(/,/g, ""));
    return Number.isFinite(v) && String(r[c] ?? "").trim() !== "" ? [{ period: `FY${y}`, value: v * 1_000_000 }] : [];
  });
  const series = (id: string, label: string, note: string): Omit<Series, "points"> => ({
    id, label, unit: "AUD", frequency: "yearly", decimals: 0, note,
    source: "ABS, Government Finance Statistics, Annual", sourceUrl: workbookUrl,
  });

  // Rows run top-level purpose, then its sub-purposes, then "Total <purpose>". A purpose with no
  // sub-purposes is one row. The table ends at "Total Expenses".
  const purposes: GfsExpenses["purposes"] = [];
  let parent: string | null = null;
  let total: Series | null = null;
  for (const r of rows.slice(rows.indexOf(yearRow) + 1)) {
    const label = String(r.A ?? "").trim();
    if (!label || /^©/.test(label)) continue;
    const pts = points(r);
    if (/^total expenses$/i.test(label)) {
      total = { ...series("gfs:commonwealth:total", "Commonwealth expenses, all purposes", "Total expenses of the Commonwealth general government sector, accrual, as the ABS measures them. Actual outcomes, not Budget estimates."), points: pts };
      break;
    }
    const totalOf = label.match(/^Total (.+)$/i);
    if (totalOf) {
      // The parent's own total, stored under the parent's id.
      const name = totalOf[1].replace(/^general public services$/i, "General public services");
      purposes.push({ name: name.charAt(0).toUpperCase() + name.slice(1), parent: null, series: { ...series(`gfs:commonwealth:${slug(name)}`, `Commonwealth expenses: ${name}`, `Commonwealth general government expenses on ${name.toLowerCase()}, accrual, all sub-purposes. ABS Government Finance Statistics, actual outcomes.`), points: pts } });
      parent = null;
      continue;
    }
    if (pts.length === 0) { parent = label; continue; } // a heading with sub-purposes beneath it
    if (parent) {
      purposes.push({ name: label, parent, series: { ...series(`gfs:commonwealth:${slug(parent)}:${slug(label)}`, `Commonwealth expenses: ${parent}, ${label.toLowerCase()}`, `Commonwealth general government expenses on ${label.toLowerCase()} within ${parent.toLowerCase()}, accrual. ABS Government Finance Statistics.`), points: pts } });
    } else {
      purposes.push({ name: label, parent: null, series: { ...series(`gfs:commonwealth:${slug(label)}`, `Commonwealth expenses: ${label}`, `Commonwealth general government expenses on ${label.toLowerCase()}, accrual. ABS Government Finance Statistics, actual outcomes.`), points: pts } });
    }
  }
  if (!total || purposes.length < 5) throw new Error(`Only ${purposes.length} purposes and ${total ? "a" : "no"} total read from the expenses-by-purpose table; the layout may have changed`);
  return { releaseYear, releaseUrl: releaseUrl(year), workbookUrl, years, purposes, total };
}
