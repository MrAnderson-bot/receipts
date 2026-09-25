// The Fuel Price Data API used by two schemes: Queensland's Fuel Price Reporting
// and South Australia's Fuel Pricing Information Scheme. Same vendor, same
// methods, different host and subscriber token. Documented in the SA "Outbound
// API Guide" at safuelpricinginformation.com.au/publishers.html.
//
// Calls: the reference lists (regions, brands, fuel types) change rarely and are cached for a week;
// the station list is cached for a day; only the price list is read each time, and the caller caches
// that for eight hours. So a scheme costs at most 3 price calls and 1 station call a day, plus 3
// reference calls a week: about 4 or 5 a day.
import { unstable_cache } from "next/cache";
import { USER_AGENT } from "../../xlsx";
import { normaliseFuel, type FuelPrice } from "./types";

const COUNTRY = 21; // Australia
const STATE_LEVEL = 3; // geographic region levels: 3 is a state
const DAY = 24 * 3_600;

type Region = { GeoRegionId: number; GeoRegionLevel: number; Name: string; Abbrev?: string; GeoRegionParentId?: number | null };

async function get<T>(base: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `FPDAPI SubscriberToken=${token}`, "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("the subscriber token was rejected (401); check the key in /etc/receipts.env");
  if (!res.ok) throw new Error(`${new URL(base).host} returned ${res.status} for ${path}`);
  return res.json();
}

type Reference = { regions: Region[]; brands: { BrandId: number; Name: string }[]; fuels: { FuelId: number; Name: string }[] };

// The token is part of the cache key only so that a changed key is not served the old answer; it never leaves the process.
const referenceCached = unstable_cache(
  async (base: string, token: string): Promise<Reference> => {
    const [regions, brands, fuels] = await Promise.all([
      get<{ GeographicRegions: Region[] }>(base, token, `/Subscriber/GetCountryGeographicRegions?countryId=${COUNTRY}`),
      get<{ Brands: Reference["brands"] }>(base, token, `/Subscriber/GetCountryBrands?countryId=${COUNTRY}`),
      get<{ Fuels: Reference["fuels"] }>(base, token, `/Subscriber/GetCountryFuelTypes?countryId=${COUNTRY}`),
    ]);
    return { regions: regions.GeographicRegions ?? [], brands: brands.Brands ?? [], fuels: fuels.Fuels ?? [] };
  },
  ["fpdapi-reference-v1"], { revalidate: 7 * DAY },
);
const sitesCached = unstable_cache(
  async (base: string, token: string, regionId: number): Promise<any[]> =>
    (await get<{ S: any[] }>(base, token, `/Subscriber/GetFullSiteDetails?countryId=${COUNTRY}&geoRegionLevel=${STATE_LEVEL}&geoRegionId=${regionId}`)).S ?? [],
  ["fpdapi-sites-v1"], { revalidate: DAY },
);

// Every current price in one state, with the station details joined on.
export async function fpdapiPrices(base: string, token: string, stateAbbrev: string): Promise<{ prices: FuelPrice[]; date: string }> {
  const { regions, brands, fuels } = await referenceCached(base, token);
  const state = regions.find((r) => r.GeoRegionLevel === STATE_LEVEL && (r.Abbrev === stateAbbrev || r.Name.toUpperCase() === stateAbbrev));
  if (!state) throw new Error(`no level-${STATE_LEVEL} region called ${stateAbbrev} in the API's region list`);
  const regionName = new Map(regions.map((r) => [r.GeoRegionId, r.Name]));

  const [sites, priced] = await Promise.all([
    sitesCached(base, token, state.GeoRegionId),
    get<{ SitePrices: any[] }>(base, token, `/Price/GetSitesPrices?countryId=${COUNTRY}&geoRegionLevel=${STATE_LEVEL}&geoRegionId=${state.GeoRegionId}`),
  ]);
  const brandName = new Map(brands.map((b) => [b.BrandId, b.Name]));
  const fuelName = new Map(fuels.map((f) => [f.FuelId, f.Name]));
  const site = new Map(sites.map((s) => [String(s.S), s]));

  const prices: FuelPrice[] = [];
  for (const p of priced.SitePrices ?? []) {
    const s = site.get(String(p.SiteId));
    const cents = Number(p.Price) / 10; // the API quotes tenths of a cent
    if (!s || !Number.isFinite(cents) || cents <= 0 || Number(p.Price) >= 9999) continue; // 9999 means out of stock
    const raw = fuelName.get(p.FuelId) ?? String(p.FuelId);
    prices.push({
      siteId: String(s.S), name: s.N ?? "", brand: brandName.get(s.B) ?? String(s.B ?? ""), address: s.A ?? "",
      // G1 is the finest region the API places the site in, which is its suburb or town.
      suburb: regionName.get(s.G1) ?? "", postcode: s.P ? String(s.P) : null,
      lat: Number(s.Lat) || null, lng: Number(s.Lng) || null,
      fuel: normaliseFuel(raw), fuelRaw: raw, price: cents, reportedAt: String(p.TransactionDateUtc ?? ""),
    });
  }
  if (prices.length === 0) throw new Error("the API returned no prices");
  const date = prices.map((p) => p.reportedAt).sort().pop()!.slice(0, 10);
  return { prices, date };
}
