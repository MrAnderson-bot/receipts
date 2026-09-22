// Taxation by level of government from the ABS annual release "Taxation
// Revenue, Australia" (cat. 5506.0). Not in the ABS Data API, so this reads the
// release's spreadsheet. CC BY 4.0.
import { unstable_cache } from "next/cache";
import { readWorkbook, USER_AGENT, type Row } from "../xlsx";
import type { YearValue } from "./treasury";

const RELEASE = "https://www.abs.gov.au/statistics/economy/government/taxation-revenue-australia/latest-release";

export type TaxByLevel = {
  releaseUrl: string;
  workbookUrl: string;
  latest: string; // latest financial year
  commonwealth: YearValue[]; // $m
  stateAndLocal: YearValue[]; // $m
  stateLines: { name: string; series: YearValue[] }[]; // main state and local taxes, largest first
};

// Row labels in Table 10 (all states, state and local government).
const STATE_LINES: [RegExp, string][] = [
  [/^Taxes on employers.? payroll and labour force/i, "Payroll tax"],
  [/^Stamp duties on conveyances/i, "Stamp duty on property transfers"],
  [/^Municipal rates/i, "Council rates"],
  [/^Land taxes/i, "Land tax"],
  [/^Total motor vehicle taxes/i, "Motor vehicle taxes"],
  [/^Total taxes on gambling/i, "Gambling taxes"],
  [/^Total taxes on insurance/i, "Insurance taxes"],
];

function table(rows: Row[]) {
  const head = rows.find((r) => Object.values(r).filter((v) => /^\d{4}-\d{2}$/.test(v.trim())).length >= 5);
  if (!head) throw new Error("ABS taxation table has no row of financial years; the layout may have changed");
  const cols = Object.entries(head).filter(([, v]) => /^\d{4}-\d{2}$/.test(v.trim()));
  return (label: RegExp): YearValue[] => {
    const r = rows.find((row) => label.test((row.A ?? "").trim()));
    if (!r) return [];
    return cols.flatMap(([c, year]) =>
      Number.isFinite(Number(r[c])) ? [{ year: year.trim(), value: Number(r[c]), estimate: false }] : []);
  };
}

async function load(): Promise<TaxByLevel> {
  const headers = { "User-Agent": USER_AGENT };
  const page = await fetch(RELEASE, { headers, cache: "no-store" });
  if (!page.ok) throw new Error(`ABS returned ${page.status} for the taxation revenue release`);
  // Data cube 1 holds the tables by level of government. Its name carries the release year.
  const href = (await page.text()).match(/href="([^"]*55060DO001_\d+\.xlsx)"/i)?.[1];
  if (!href) throw new Error("No data cube link found on the ABS taxation revenue page");
  const workbookUrl = new URL(href, RELEASE).toString();

  const file = await fetch(workbookUrl, { headers, cache: "no-store" });
  if (!file.ok) throw new Error(`ABS returned ${file.status} for the taxation revenue workbook`);
  const book = readWorkbook(Buffer.from(await file.arrayBuffer()));

  const commonwealth = table(book.sheet("Table_1"))(/^Total Taxation on Commonwealth/i);
  const states = table(book.sheet("Table_10"));
  const stateAndLocal = states(/^Total Taxation all States/i);
  if (commonwealth.length === 0 || stateAndLocal.length === 0) {
    throw new Error("ABS taxation workbook is missing its total rows; the layout may have changed");
  }
  const latest = stateAndLocal[stateAndLocal.length - 1].year;
  const at = (s: YearValue[]) => s.find((p) => p.year === latest)?.value ?? 0;

  return {
    releaseUrl: RELEASE, workbookUrl, latest, commonwealth, stateAndLocal,
    stateLines: STATE_LINES.map(([label, name]) => ({ name, series: states(label) }))
      .filter((l) => l.series.length > 0)
      .sort((a, b) => at(b.series) - at(a.series)),
  };
}

// An annual release; checking once a day is plenty.
const cached = unstable_cache(load, ["abs-taxation-revenue"], { revalidate: 86_400 });

export async function tryGetTaxByLevel(): Promise<{ data: TaxByLevel | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
