// New South Wales and Tasmania: FuelCheck, the NSW Government's price
// reporting scheme, which Tasmania joined as FuelCheck TAS. One API, v2, on the
// NSW API portal. Needs an app key and secret (FUELCHECK_NSW_KEY and
// FUELCHECK_NSW_SECRET) from a free registration.
//
// Calls: the free tier allows 2,500 a month. One load is two calls: a token, then every current
// price in both states in one response (`states=NSW|TAS`; without that parameter the API returns
// NSW only). The nightly build loads it twice at most (page render and snapshot), so 4 calls a day,
// about 120 a month.
import { httpJson } from "./http";
import { needsKey, normaliseFuel, summarise, type FuelPrice, type FuelSummary } from "./types";

const BASE = "https://api.onegov.nsw.gov.au";
const SIGNUP = "https://api.nsw.gov.au/Product/Index/22";
const STATES = ["NSW", "TAS"] as const;
type FuelCheckState = (typeof STATES)[number];

export const nswKey = (): string | null =>
  process.env.FUELCHECK_NSW_KEY && process.env.FUELCHECK_NSW_SECRET ? null : needsKey("an API key and secret for FuelCheck v2", SIGNUP);

// "25/09/2026 09:41:12 AM", the timestamp format the API insists on.
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const h = d.getHours() % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"}`;
};

type Priced = FuelPrice & { state: string };

async function fetchAll(): Promise<Priced[]> {
  const key = process.env.FUELCHECK_NSW_KEY!, secret = process.env.FUELCHECK_NSW_SECRET!;
  const auth = await httpJson(`${BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`, {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
  });
  if (auth.status !== 200 || !auth.json?.access_token) throw new Error(`FuelCheck token request returned ${auth.status}; check the key and secret`);
  const token = auth.json.access_token;

  const res = await httpJson(`${BASE}/FuelPriceCheck/v2/fuel/prices?states=${encodeURIComponent(STATES.join("|"))}`, {
    apikey: key, Authorization: `Bearer ${token}`, transactionid: crypto.randomUUID(), requesttimestamp: stamp(),
    "Content-Type": "application/json; charset=utf-8",
  });
  if (res.status !== 200 || res.json === null) throw new Error(`FuelCheck returned ${res.status}`);
  const json = res.json;
  // Station codes are not unique across states, so the key carries the state too.
  const stationKey = (code: unknown, state: unknown) => `${String(state ?? "").toUpperCase()}:${String(code)}`;
  const stations = new Map<string, any>((json.stations ?? []).map((s: any) => [stationKey(s.code, s.state), s]));
  const byCode = new Map<string, any>((json.stations ?? []).map((s: any) => [String(s.code), s]));

  const prices: Priced[] = [];
  for (const p of json.prices ?? []) {
    const s = stations.get(stationKey(p.stationcode, p.state)) ?? byCode.get(String(p.stationcode));
    const cents = Number(p.price);
    if (!s || !Number.isFinite(cents) || cents <= 0) continue;
    // "123 Main St, Suburb NSW 2000": the suburb and postcode sit in the address.
    const addr = String(s.address ?? "");
    const m = addr.match(/,\s*([^,]+?)\s+(NSW|TAS|ACT)\s+(\d{4})\s*$/i);
    const state = String(p.state ?? s.state ?? (m ? m[2] : "NSW")).toUpperCase();
    prices.push({
      siteId: `${state}:${s.code}`, name: s.name ?? "", brand: s.brand ?? "", address: addr,
      suburb: m ? m[1] : "", postcode: m ? m[3] : null,
      lat: Number(s.location?.latitude) || null, lng: Number(s.location?.longitude) || null,
      fuel: normaliseFuel(String(p.fueltype ?? "")), fuelRaw: String(p.fueltype ?? ""), price: cents,
      reportedAt: String(p.lastupdated ?? ""),
      state,
    });
  }
  if (prices.length === 0) throw new Error("FuelCheck returned no prices");
  return prices;
}

// Both states from the one response. Uncached here: lib/sources/fuel/index.ts caches the page summaries.
export async function loadFuelCheck(): Promise<Record<FuelCheckState, FuelSummary>> {
  if (nswKey()) throw new Error(nswKey()!);
  const all = await fetchAll();
  const date = new Date().toISOString().slice(0, 10);
  const out = {} as Record<FuelCheckState, FuelSummary>;
  for (const code of STATES) {
    const mine = all.filter((p) => p.state === code).map(({ state, ...p }) => p);
    if (mine.length === 0) throw new Error(`FuelCheck returned no ${code} prices`);
    const nsw = code === "NSW";
    out[code] = summarise(mine, {
      code, name: nsw ? "New South Wales" : "Tasmania", date, live: true,
      coverage: nsw
        ? "Current price at every NSW site reporting to FuelCheck, which retailers must update within 30 minutes of a change. The ACT has no price reporting scheme and is not covered."
        : "Current price at every Tasmanian site reporting to FuelCheck TAS, which runs on the NSW FuelCheck system.",
      sourceName: nsw ? "NSW FuelCheck API v2" : "FuelCheck TAS, via the NSW FuelCheck API v2",
      sourceUrl: nsw ? "https://www.fuelcheck.nsw.gov.au/" : "https://www.fuelcheck.tas.gov.au/",
      licence: "NSW API portal terms, shown with attribution",
    });
  }
  return out;
}
