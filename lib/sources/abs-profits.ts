// Company profits by industry from the ABS quarterly Business Indicators
// survey (cat. 5676.0), through the ABS Data API. CC BY 4.0.
import { parseCsv } from "../csv";

const FLOW = "https://data.api.abs.gov.au/rest/data/ABS,QBIS,1.0.0";

export type IndustryProfit = { industry: string; value: number; previousYear: number | null }; // $

export type Profits = {
  quarter: string; // 2026-Q2
  sourceUrl: string;
  industries: IndustryProfit[]; // largest first, all-industries total excluded
  total: IndustryProfit | null;
};

// Key order: measure . price . industry . business scope . adjustment . region . frequency
// M7 = gross operating profits, CUR = current prices, blank = every industry,
// TOT = all businesses, 20 = seasonally adjusted.
export async function getProfitsByIndustry(): Promise<Profits> {
  const from = `${new Date().getFullYear() - 2}-Q1`;
  const url = `${FLOW}/M7.CUR..TOT.20.AUS.Q?startPeriod=${from}`;
  const res = await fetch(url, { headers: { Accept: "application/vnd.sdmx.data+csv;labels=both" }, next: { revalidate: 21_600 } });
  if (!res.ok) throw new Error(`ABS returned ${res.status} for business indicators`);

  const rows = parseCsv(await res.text());
  const col = (name: string) => rows[0].findIndex((h) => h.startsWith(name));
  const [iInd, iTime, iVal, iMult] = [col("INDUSTRY"), col("TIME_PERIOD"), col("OBS_VALUE"), col("UNIT_MULT")];
  if (iInd < 0 || iTime < 0 || iVal < 0) throw new Error("ABS business indicators response is missing expected columns");

  const byIndustry = new Map<string, Map<string, number>>();
  for (const r of rows.slice(1)) {
    const value = Number(r[iVal]);
    if (!Number.isFinite(value)) continue;
    // Values come in $ million: the multiplier column reads "6: Millions".
    const scale = 10 ** (Number((r[iMult] ?? "6").split(":")[0]) || 6);
    const label = r[iInd].replace(/^[A-Z]+:\s*/, "");
    if (!byIndustry.has(label)) byIndustry.set(label, new Map());
    byIndustry.get(label)!.set(r[iTime], value * scale);
  }

  const quarter = [...new Set([...byIndustry.values()].flatMap((m) => [...m.keys()]))].sort().pop() ?? "";
  const yearAgo = quarter.replace(/^(\d{4})/, (y) => String(Number(y) - 1));
  const all = [...byIndustry.entries()]
    .filter(([, m]) => m.has(quarter))
    .map(([industry, m]) => ({ industry, value: m.get(quarter)!, previousYear: m.get(yearAgo) ?? null }));

  return {
    quarter, sourceUrl: `${url}&format=csv`,
    total: all.find((x) => /^All Industries$/i.test(x.industry)) ?? null,
    industries: all.filter((x) => !/^All Industries$/i.test(x.industry)).sort((a, b) => b.value - a.value),
  };
}

export async function tryGetProfits(): Promise<{ data: Profits | null; error: string | null }> {
  try {
    return { data: await getProfitsByIndustry(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
