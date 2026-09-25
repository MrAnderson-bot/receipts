// Queensland: the Fuel Price Reporting scheme. With a key (FUEL_QLD_KEY) the
// live API gives every current price. Without one, the scheme's monthly CSV on
// data.qld.gov.au (CC BY 4.0) gives every price change in the month, from which
// each site's last price is taken. That file is up to a month behind.
// Calls with a key: see fpdapi.ts; about 4 or 5 a day. Without one: two requests to data.qld.gov.au a day.
import { parseCsv } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { fpdapiPrices } from "./fpdapi";
import { needsKey, normaliseFuel, summarise, type FuelPrice, type FuelSummary } from "./types";

const CKAN = "https://www.data.qld.gov.au/api/3/action";
const LIVE_BASE = "https://fppdirectapi-prod.fuelpricesqld.com.au";
const SIGNUP = "https://www.fuelpricesqld.com.au/";

// null when the live feed can be used; otherwise what the owner has to do. The file feed still works without it.
export const qldKey = (): string | null => (process.env.FUEL_QLD_KEY ? null : needsKey("a subscriber token for the live API (the monthly file is used instead)", SIGNUP));

export async function loadQld(): Promise<FuelSummary> {
  const token = process.env.FUEL_QLD_KEY;
  if (token) {
    const { prices, date } = await fpdapiPrices(LIVE_BASE, token, "QLD");
    return summarise(prices, {
      code: "QLD", name: "Queensland", date, live: true,
      coverage: "Current price at every site reporting to the Queensland Fuel Price Reporting scheme, read from its live API.",
      sourceName: "Queensland Fuel Price Reporting, live API", sourceUrl: SIGNUP, licence: "Scheme data publisher terms, shown with attribution",
    });
  }
  return loadQldFile();
}

// "04/08/2026 22:54" (UTC) -> "2026-08-04T22:54:00Z"
const iso = (raw: string) => {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "0").padStart(2, "0")}:${m[5] ?? "00"}:00Z` : "";
};

async function loadQldFile(): Promise<FuelSummary> {
  const headers = { "User-Agent": USER_AGENT };
  // One dataset per calendar year; January's file lands in the previous year's dataset until the new one exists.
  const year = new Date().getFullYear();
  let dataset: any = null;
  for (const y of [year, year - 1]) {
    const res = await fetch(`${CKAN}/package_show?id=fuel-price-reporting-${y}`, { headers, cache: "no-store" });
    if (res.ok) { dataset = (await res.json()).result; break; }
  }
  if (!dataset) throw new Error("no fuel-price-reporting dataset found on data.qld.gov.au");
  const files: any[] = dataset.resources.filter((r: any) => /csv/i.test(r.format)).sort((a: any, b: any) => String(b.last_modified).localeCompare(String(a.last_modified)));
  const file = files[0];
  if (!file) throw new Error(`no CSV in ${dataset.title}`);

  const res = await fetch(file.url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.qld.gov.au returned ${res.status} for ${file.name}`);
  const rows = parseCsv(await res.text());
  const col = Object.fromEntries(rows[0].map((h, i) => [h.replace(/^﻿/, ""), i]));
  const get = (r: string[], name: string) => r[col[name]] ?? "";

  // The file lists every change; the last one for a site and fuel is its price at the end of the month.
  const latest = new Map<string, FuelPrice>();
  for (const r of rows.slice(1)) {
    const tenths = Number(get(r, "Price"));
    const at = iso(get(r, "TransactionDateutc"));
    if (!Number.isFinite(tenths) || tenths <= 0 || tenths >= 9999 || !at) continue; // 9999 means no stock
    const raw = get(r, "Fuel_Type");
    const key = `${get(r, "SiteId")}|${raw}`;
    const seen = latest.get(key);
    if (seen && seen.reportedAt > at) continue;
    latest.set(key, {
      siteId: get(r, "SiteId"), name: get(r, "Site_Name"), brand: get(r, "Site_Brand"), address: get(r, "Sites_Address_Line_1"),
      suburb: get(r, "Site_Suburb"), postcode: get(r, "Site_Post_Code") || null,
      lat: Number(get(r, "Site_Latitude")) || null, lng: Number(get(r, "Site_Longitude")) || null,
      fuel: normaliseFuel(raw), fuelRaw: raw, price: tenths / 10, reportedAt: at,
    });
  }
  const prices = [...latest.values()];
  if (prices.length === 0) throw new Error(`${file.name} had no usable prices`);
  const date = prices.map((p) => p.reportedAt).sort().pop()!.slice(0, 10);

  return summarise(prices, {
    code: "QLD", name: "Queensland", date, live: false,
    coverage: `Each site's last reported price in ${file.name.replace(/^Queensland Fuel Prices\s*/i, "")}, the newest monthly file the scheme has released. Prices reported to the scheme are the prices charged, but this file can be weeks behind: the live API needs a key.`,
    sourceName: dataset.title, sourceUrl: `https://www.data.qld.gov.au/dataset/${dataset.name}`, licence: dataset.license_title ?? "CC BY 4.0",
  });
}
