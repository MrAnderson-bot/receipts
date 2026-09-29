// Northern Territory fuel prices from MyFuel NT. The site has no station download, but its results
// page is fed by a public JSON endpoint that gives the average price in each of its regions for one fuel:
// https://myfuelnt.nt.gov.au/Home/GetRegionCurrentTrend?FuelCode=U91 (no key, no session; found 29
// September 2026). So the Territory is covered at region level (Darwin, Palmerston, Litchfield, Top End
// Rural, Katherine, Barkly, Central Australia, Tiwi Island ...), not station level: the "cheapest" and
// "dearest" here are the cheapest and dearest regional averages, and the count is regions, not stations.
// Data: Northern Territory Government, MyFuel NT.
import { httpJson } from "./http";
import { FUEL_LABELS, type FuelStat, type FuelSummary, type FuelType } from "./types";

const BASE = "https://myfuelnt.nt.gov.au";
export const NT_SOURCE = `${BASE}/`;
// The fuel codes the site's own search form offers, mapped to this project's codes. One call each.
const FUELS: [string, FuelType][] = [["U91", "U91"], ["DL", "DL"], ["P95", "P95"], ["P98", "P98"], ["LPG", "LPG"]];

type Trend = { FuelCode: string | null; FuelName: string; RegionPrices: { RegionName: string; AveragePrice: number }[] };

export type NtRegion = { fuel: FuelType; region: string; average: number };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function loadNt(): Promise<FuelSummary & { regions: NtRegion[] }> {
  const regions: NtRegion[] = [];
  const stats: FuelStat[] = [];
  for (const [code, fuel] of FUELS) {
    const { status, json } = await httpJson<Trend>(`${BASE}/Home/GetRegionCurrentTrend?FuelCode=${code}`, { Accept: "application/json" });
    if (status !== 200 || !json?.RegionPrices) throw new Error(`MyFuel NT returned ${status} for ${code}`);
    const rows = json.RegionPrices.filter((r) => Number.isFinite(r.AveragePrice) && r.AveragePrice > 0);
    if (rows.length === 0) continue;
    for (const r of rows) regions.push({ fuel, region: r.RegionName, average: r.AveragePrice });
    const values = rows.map((r) => r.AveragePrice);
    stats.push({ fuel, label: FUEL_LABELS[fuel], raw: json.FuelName, median: median(values), cheapest: Math.min(...values), dearest: Math.max(...values), count: rows.length });
  }
  if (stats.length === 0) throw new Error("MyFuel NT gave no regional prices");
  // Darwin's date: the site publishes today's averages with no timestamp.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Darwin" }).format(new Date());
  return {
    code: "NT", name: "Northern Territory", date, live: true,
    coverage: "Average price in each MyFuel NT region today, not station prices: the scheme publishes no station download, so cheapest and dearest here are the cheapest and dearest regional averages and the count is regions.",
    sourceName: "MyFuel NT (Northern Territory Government)", sourceUrl: NT_SOURCE, licence: "Northern Territory Government, terms on the site",
    stationCount: 0, implausible: 0, stats: stats.sort((a, b) => b.count - a.count), cheapest: {}, prices: [], regions,
  };
}

export const ntKey = (): string | null => null;
