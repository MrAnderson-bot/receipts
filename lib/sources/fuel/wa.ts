// Western Australia: FuelWatch publishes today's price at every site as an RSS
// feed, no key. Retailers must lock in tomorrow's price by 2pm, so the feed is
// exact for the day. One request per product: the feed's title says "All Metro
// Regions" but it carries every site in the state (Kalgoorlie, Broome and the
// Gascoyne are all in it), and the StateRegion filter only repeats those rows.
import { USER_AGENT } from "../../xlsx";
import { normaliseFuel, summarise, type FuelPrice, type FuelSummary, type FuelType } from "./types";

const RSS = "https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS";

// FuelWatch product codes, as its RSS documents them.
const PRODUCTS: [number, FuelType, string][] = [
  [1, "U91", "Unleaded Petrol"], [4, "DL", "Diesel"], [2, "P95", "Premium Unleaded 95"], [6, "P98", "Premium Unleaded 98"], [5, "LPG", "LPG"],
];
const REGIONS: (number | null)[] = [null]; // the unfiltered feed; see above

const tag = (item: string, name: string) => {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim() : "";
};

export async function loadWa(): Promise<FuelSummary> {
  const jobs = PRODUCTS.flatMap(([product, fuel, fuelRaw]) =>
    REGIONS.map(async (region) => {
      const url = `${RSS}?Product=${product}${region === null ? "" : `&StateRegion=${region}`}`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
      if (!res.ok) throw new Error(`FuelWatch returned ${res.status} for product ${product}`);
      const xml = await res.text();
      const out: FuelPrice[] = [];
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const item = m[1];
        const price = Number(tag(item, "price"));
        const name = tag(item, "trading-name"), address = tag(item, "address");
        if (!Number.isFinite(price) || !name) continue;
        out.push({
          siteId: `${name} | ${address}`.toLowerCase(),
          name, brand: tag(item, "brand"), address,
          suburb: tag(item, "location"), postcode: null,
          lat: Number(tag(item, "latitude")) || null, lng: Number(tag(item, "longitude")) || null,
          fuel, fuelRaw, price, reportedAt: tag(item, "date"),
        });
      }
      return out;
    }),
  );
  const prices = (await Promise.all(jobs)).flat();
  if (prices.length === 0) throw new Error("FuelWatch returned no prices");
  const date = prices.map((p) => p.reportedAt).sort().pop()!;

  return summarise(prices, {
    code: "WA", name: "Western Australia", date, live: true,
    coverage: "Today's price at every site that reports to FuelWatch, metropolitan and regional. WA retailers must fix the next day's price by 2pm, so these are the prices actually charged today.",
    sourceName: "FuelWatch RSS feed", sourceUrl: "https://www.fuelwatch.wa.gov.au/",
    licence: "FuelWatch copyright, shown with attribution",
  });
}

export const waKey = (): string | null => null;
