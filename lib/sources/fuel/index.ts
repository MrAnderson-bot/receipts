// Fuel prices by state and territory, from each government's price reporting
// scheme. One module per scheme, all returning FuelSummary.
import { unstable_cache } from "next/cache";
import { loadNsw, loadTas, nswKey } from "./nsw";
import { loadQld, qldKey } from "./qld";
import { loadSa, saKey } from "./sa";
import { loadVic, vicKey } from "./vic";
import { loadWa, waKey } from "./wa";
import type { FuelCode, FuelSummary } from "./types";

export type { FuelCode, FuelSummary, FuelPrice, FuelStat, FuelType } from "./types";
export { FUEL_LABELS, SHOWN } from "./types";

const LOADERS: Record<FuelCode, { load: () => Promise<FuelSummary>; key: () => string | null }> = {
  NSW: { load: loadNsw, key: nswKey }, VIC: { load: loadVic, key: vicKey }, QLD: { load: loadQld, key: qldKey },
  WA: { load: loadWa, key: waKey }, SA: { load: loadSa, key: saKey }, TAS: { load: loadTas, key: nswKey },
};
export const FUEL_CODES = Object.keys(LOADERS) as FuelCode[];

// What the owner has to register for each scheme to go live, or null when it already is. Queensland
// works from the monthly file without one, so its message is advice rather than a failure.
export const keyNeeded = (code: FuelCode) => LOADERS[code].key();

// Schemes read through a keyed API. Their free tiers are small (FuelCheck: 2,400 calls a month), so a
// keyed scheme is read at most three times a day and a failure waits the same eight hours before a retry.
const keyed = (code: FuelCode) => code !== "WA" && !(code === "QLD" && !process.env.FUEL_QLD_KEY);
const HOURS = 3_600;
const revalidateFor = (code: FuelCode) => (keyed(code) ? 8 * HOURS : 24 * HOURS);
const cooldownFor = (code: FuelCode) => (keyed(code) ? 8 * HOURS * 1000 : 20 * 60_000);

// Places with no feed this project can read, and why.
export const NOT_CONNECTED: { name: string; url: string; why: string }[] = [
  {
    name: "Northern Territory fuel prices (MyFuel NT)", url: "https://myfuelnt.nt.gov.au/",
    why: "MyFuel NT publishes no API and no download. Its results page only answers a browser session, so there is nothing a nightly job can read.",
  },
  {
    name: "ACT fuel prices", url: "https://www.accc.gov.au/consumers/petrol-and-fuel/petrol-price-cycles-in-major-cities",
    why: "The ACT has no fuel price reporting scheme, and NSW FuelCheck does not cover it.",
  },
];

// Bump a scheme's number after changing its loader, so only that scheme is re-read.
const REVISION: Partial<Record<FuelCode, number>> = { WA: 1 };
const caches = new Map<FuelCode, (code: FuelCode) => Promise<FuelSummary>>();
function cached(code: FuelCode) {
  if (!caches.has(code)) {
    const key = ["fuel-prices-v1", `${code}-${REVISION[code] ?? 0}`];
    caches.set(code, unstable_cache((c: FuelCode) => LOADERS[c].load(), key, { revalidate: revalidateFor(code) }));
  }
  return caches.get(code)!(code);
}

// A failed load isn't cached, so without this every page view would retry a source that just refused us.
const failures = new Map<FuelCode, { at: number; error: string }>();

export async function tryGetFuel(code: FuelCode): Promise<{ data: FuelSummary | null; error: string | null }> {
  // A missing key is not a failure to cache or cool down; it is a fact about the environment.
  const missing = LOADERS[code].key();
  if (missing && code !== "QLD") return { data: null, error: missing };
  const recent = failures.get(code);
  if (recent && Date.now() - recent.at < cooldownFor(code)) return { data: null, error: `${recent.error} Not retried for ${keyed(code) ? "eight hours" : "twenty minutes"}.` };
  try {
    const data = await cached(code);
    failures.delete(code);
    return { data, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    failures.set(code, { at: Date.now(), error });
    return { data: null, error };
  }
}
