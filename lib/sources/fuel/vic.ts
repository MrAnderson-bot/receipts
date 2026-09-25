// Victoria: Service Victoria's Servo Saver Public API. Access needs an API
// Consumer ID issued after an application (FUEL_VIC_CONSUMER_ID). The endpoint
// and response layout come with the approval, so the base URL is read from
// FUEL_VIC_URL and the parser below is written against the documented fields
// (station name, brand, address, suburb, fuel type, price, last updated) and
// tolerates their casing. Check the first live run against the approval pack.
//
// Calls: one per load, cached for eight hours by lib/sources/fuel/index.ts, so at most 3 a day.
import { USER_AGENT } from "../../xlsx";
import { needsKey, normaliseFuel, summarise, type FuelPrice, type FuelSummary } from "./types";

const APPLY = "https://service.vic.gov.au/find-services/transport-and-driving/servo-saver/help-centre/servo-saver-public-api/apply-for-servo-saver-public-api";

export const vicKey = (): string | null =>
  process.env.FUEL_VIC_CONSUMER_ID && process.env.FUEL_VIC_URL ? null : needsKey("an API Consumer ID (FUEL_VIC_CONSUMER_ID) and the endpoint URL from the approval email (FUEL_VIC_URL)", APPLY);

// Reads a field by any of several names, whatever case the API uses.
const pick = (o: any, ...names: string[]) => {
  for (const n of names) for (const k of Object.keys(o ?? {})) if (k.toLowerCase() === n.toLowerCase()) return o[k];
  return undefined;
};

export async function loadVic(): Promise<FuelSummary> {
  if (vicKey()) throw new Error(vicKey()!);
  const res = await fetch(process.env.FUEL_VIC_URL!, {
    headers: { "x-api-consumer-id": process.env.FUEL_VIC_CONSUMER_ID!, Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Servo Saver API returned ${res.status}`);
  const json = await res.json();
  const list: any[] = Array.isArray(json) ? json : pick(json, "stations", "sites", "data", "results") ?? [];

  const prices: FuelPrice[] = [];
  for (const s of list) {
    const fuels: any[] = pick(s, "prices", "fuelPrices", "fuels") ?? [];
    for (const f of fuels) {
      const cents = Number(pick(f, "price", "amount"));
      if (!Number.isFinite(cents) || cents <= 0) continue;
      const raw = String(pick(f, "fuelType", "fuel", "type", "name") ?? "");
      prices.push({
        siteId: String(pick(s, "id", "siteId", "stationId", "code") ?? `${pick(s, "name")}|${pick(s, "address")}`),
        name: String(pick(s, "name", "siteName", "stationName") ?? ""), brand: String(pick(s, "brand", "brandName") ?? ""),
        address: String(pick(s, "address", "addressLine1") ?? ""), suburb: String(pick(s, "suburb", "locality") ?? ""),
        postcode: pick(s, "postcode") ? String(pick(s, "postcode")) : null,
        lat: Number(pick(s, "latitude", "lat")) || null, lng: Number(pick(s, "longitude", "lng", "lon")) || null,
        fuel: normaliseFuel(raw), fuelRaw: raw, price: cents > 1000 ? cents / 10 : cents, // tenths of a cent or cents
        reportedAt: String(pick(f, "lastUpdated", "updatedAt", "reportedAt") ?? ""),
      });
    }
  }
  if (prices.length === 0) throw new Error("Servo Saver API returned no prices in a layout this loader understands; compare it with the approval pack");
  return summarise(prices, {
    code: "VIC", name: "Victoria", date: new Date().toISOString().slice(0, 10), live: true,
    coverage: "Current price at every Victorian site reporting to Servo Saver. Victorian retailers report within a day of a change, so a price can lag by up to 24 hours.",
    sourceName: "Servo Saver Public API", sourceUrl: "https://service.vic.gov.au/find-services/transport-and-driving/servo-saver", licence: "Servo Saver Open API terms, shown with attribution",
  });
}
