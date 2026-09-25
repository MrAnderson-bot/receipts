// New South Wales and Tasmania: FuelCheck, the NSW Government's price
// reporting scheme, which Tasmania joined as FuelCheck TAS. One API, v2, on the
// NSW API portal. Needs an app key and secret (FUELCHECK_NSW_KEY and
// FUELCHECK_NSW_SECRET) from a free registration.
//
// Calls: the free tier allows 2,400 a month. One load is two calls (a token, then every price in one
// response), the response is cached for eight hours and shared by the NSW and TAS loaders, so the most
// this makes is 6 calls a day, about 180 a month.
import { unstable_cache } from "next/cache";
import { USER_AGENT } from "../../xlsx";
import { needsKey, normaliseFuel, summarise, type FuelPrice, type FuelSummary } from "./types";

const BASE = "https://api.onegov.nsw.gov.au";
const SIGNUP = "https://api.nsw.gov.au/Product/Index/22";
const EIGHT_HOURS = 8 * 3_600;

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

// One response covers both states, so it is read once and split by the station's state.
async function fetchAll(): Promise<Priced[]> {
  const key = process.env.FUELCHECK_NSW_KEY!, secret = process.env.FUELCHECK_NSW_SECRET!;
  const auth = await fetch(`${BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!auth.ok) throw new Error(`FuelCheck token request returned ${auth.status}; check the key and secret`);
  const token = (await auth.json()).access_token;

  const res = await fetch(`${BASE}/FuelPriceCheck/v2/fuel/prices`, {
    headers: {
      apikey: key, Authorization: `Bearer ${token}`, transactionid: crypto.randomUUID(), requesttimestamp: stamp(),
      "Content-Type": "application/json; charset=utf-8", "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FuelCheck returned ${res.status}`);
  const json = await res.json();
  const stations = new Map<string, any>((json.stations ?? []).map((s: any) => [String(s.code), s]));

  const prices: Priced[] = [];
  for (const p of json.prices ?? []) {
    const s = stations.get(String(p.stationcode));
    const cents = Number(p.price);
    if (!s || !Number.isFinite(cents) || cents <= 0) continue;
    // "123 Main St, Suburb NSW 2000": the suburb and postcode sit in the address.
    const addr = String(s.address ?? "");
    const m = addr.match(/,\s*([^,]+?)\s+(NSW|TAS|ACT)\s+(\d{4})\s*$/i);
    prices.push({
      siteId: String(s.code), name: s.name ?? "", brand: s.brand ?? "", address: addr,
      suburb: m ? m[1] : "", postcode: m ? m[3] : null,
      lat: Number(s.location?.latitude) || null, lng: Number(s.location?.longitude) || null,
      fuel: normaliseFuel(String(p.fueltype ?? "")), fuelRaw: String(p.fueltype ?? ""), price: cents,
      reportedAt: String(p.lastupdated ?? ""),
      state: String(p.state ?? s.state ?? (m ? m[2] : "NSW")).toUpperCase(),
    });
  }
  if (prices.length === 0) throw new Error("FuelCheck returned no prices");
  return prices;
}

// One response serves both states for eight hours, whichever loader asked first.
const fetchAllCached = unstable_cache(fetchAll, ["fuelcheck-prices-v1"], { revalidate: EIGHT_HOURS });

async function load(code: "NSW" | "TAS"): Promise<FuelSummary> {
  if (nswKey()) throw new Error(nswKey()!);
  const mine = (await fetchAllCached()).filter((p) => p.state === code).map(({ state, ...p }) => p);
  if (mine.length === 0) throw new Error(`FuelCheck returned no ${code} prices`);
  const nsw = code === "NSW";
  return summarise(mine, {
    code, name: nsw ? "New South Wales" : "Tasmania", date: new Date().toISOString().slice(0, 10), live: true,
    coverage: nsw
      ? "Current price at every NSW site reporting to FuelCheck, which retailers must update within 30 minutes of a change. The ACT has no price reporting scheme and is not covered."
      : "Current price at every Tasmanian site reporting to FuelCheck TAS, which runs on the NSW FuelCheck system.",
    sourceName: nsw ? "NSW FuelCheck API v2" : "FuelCheck TAS, via the NSW FuelCheck API v2",
    sourceUrl: nsw ? "https://www.fuelcheck.nsw.gov.au/" : "https://www.fuelcheck.tas.gov.au/",
    licence: "NSW API portal terms, shown with attribution",
  });
}

export const loadNsw = () => load("NSW");
export const loadTas = () => load("TAS");
