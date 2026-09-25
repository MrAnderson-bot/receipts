// One shape for every state fuel price scheme, so a new scheme is one new module.
// Prices are cents per litre with one decimal, the way every scheme quotes them.

export type FuelCode = "NSW" | "VIC" | "QLD" | "WA" | "SA" | "TAS";

export type FuelType = "U91" | "E10" | "P95" | "P98" | "DL" | "PD" | "LPG" | "E85" | "B20" | "OTHER";

export const FUEL_LABELS: Record<FuelType, string> = {
  U91: "Unleaded 91", E10: "E10", P95: "Premium 95", P98: "Premium 98", DL: "Diesel",
  PD: "Premium diesel", LPG: "LPG", E85: "E85", B20: "Biodiesel 20", OTHER: "Other",
};

// The fuels shown on the page, in order. Everything else is stored but not charted.
export const SHOWN: FuelType[] = ["U91", "DL", "P95", "P98", "E10"];

export type FuelPrice = {
  siteId: string; // the scheme's own station id, or name plus address where it has none
  name: string;
  brand: string;
  address: string;
  suburb: string;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  fuel: FuelType;
  fuelRaw: string; // as the scheme names it
  price: number; // cents per litre
  reportedAt: string; // ISO date or date-time, as the scheme gives it
};

export type FuelStat = { fuel: FuelType; label: string; median: number; cheapest: number; dearest: number; count: number };

export type FuelSummary = {
  code: FuelCode;
  name: string;
  date: string; // the day the prices are for
  live: boolean; // true when read from the scheme's live feed, false from a periodic file
  coverage: string; // what is and isn't in the data, in words
  sourceName: string;
  sourceUrl: string;
  licence: string;
  stationCount: number;
  implausible: number; // prices outside PLAUSIBLE, kept in `prices` but left out of the figures
  stats: FuelStat[]; // one per fuel type seen, most stations first
  cheapest: Partial<Record<FuelType, FuelPrice[]>>; // ten cheapest stations per fuel
  prices: FuelPrice[]; // every price, for the fuel_prices table; dropped from page snapshots
};

// Cents per litre a road fuel can really cost. Schemes carry entry errors (a 28.8¢ diesel, a 999.6¢ "no stock"
// sentinel that missed the 9999 check), and one of those would become the state's cheapest or dearest price.
export const PLAUSIBLE: [number, number] = [80, 500];
const plausible = (p: FuelPrice) => p.price >= PLAUSIBLE[0] && p.price <= PLAUSIBLE[1];

// How each scheme names fuels, mapped to one code. Unmatched names are kept as OTHER.
export function normaliseFuel(raw: string): FuelType {
  const t = raw.trim().toLowerCase();
  if (/^(u91|ulp|unleaded|unleaded 91|regular unleaded)$/.test(t) || t === "unleaded petrol") return "U91";
  if (/e10|ethanol 94|unleaded 94/.test(t)) return "E10";
  if (/e85|ethanol 105/.test(t)) return "E85";
  if (/b20|biodiesel/.test(t)) return "B20";
  if (/premium diesel|^pd$|^pdl$|brand diesel|truck diesel/.test(t)) return "PD";
  if (/diesel|^dl$/.test(t)) return "DL";
  if (/lpg/.test(t)) return "LPG";
  if (/98|^p98$|premium 98|pulp 98/.test(t)) return "P98";
  if (/95|96|^p95$|premium 95|pulp 95|premium unleaded/.test(t)) return "P95";
  return "OTHER";
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarise(
  prices: FuelPrice[],
  meta: Pick<FuelSummary, "code" | "name" | "date" | "live" | "coverage" | "sourceName" | "sourceUrl" | "licence">,
): FuelSummary {
  // One row per station and fuel, however many times a feed repeats it.
  const seen = new Set<string>();
  prices = prices.filter((p) => { const k = `${p.siteId}|${p.fuelRaw}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const usable = prices.filter(plausible);
  const byFuel = new Map<FuelType, FuelPrice[]>();
  for (const p of usable) byFuel.set(p.fuel, [...(byFuel.get(p.fuel) ?? []), p]);
  const stats: FuelStat[] = [...byFuel]
    .map(([fuel, ps]) => {
      const values = ps.map((p) => p.price);
      return { fuel, label: FUEL_LABELS[fuel], median: median(values), cheapest: Math.min(...values), dearest: Math.max(...values), count: ps.length };
    })
    .sort((a, b) => b.count - a.count);
  const cheapest: Partial<Record<FuelType, FuelPrice[]>> = {};
  for (const [fuel, ps] of byFuel) cheapest[fuel] = [...ps].sort((a, b) => a.price - b.price).slice(0, 10);
  return { ...meta, stationCount: new Set(prices.map((p) => p.siteId)).size, implausible: prices.length - usable.length, stats, cheapest, prices };
}

// A "needs a key" answer, worded so the sources page tells the owner exactly what to do.
export const needsKey = (what: string, url: string) => `needs ${what}: register at ${url} (personal account, not a company one) and put it in /etc/receipts.env on the VM.`;
