// Fuel prices by state and territory, from each government's price reporting
// scheme. One module per scheme, all returning FuelSummary. A scheme is a feed;
// FuelCheck is one feed that gives two states.
import { unstable_cache } from "next/cache";
import { loadFuelCheck, nswKey } from "./nsw";
import { loadQld, qldKey } from "./qld";
import { loadSa, saKey } from "./sa";
import { loadVic, vicKey } from "./vic";
import { loadWa, waKey } from "./wa";
import { forPage, type FuelCode, type FuelPage, type FuelSummary } from "./types";

export type { FuelCode, FuelSummary, FuelPage, FuelPrice, FuelStat, FuelType } from "./types";
export { FUEL_LABELS, SHOWN } from "./types";

type Loaded = Partial<Record<FuelCode, FuelSummary>>;
type Feed = { states: FuelCode[]; load: () => Promise<Loaded>; key: () => string | null };
const one = (code: FuelCode, load: () => Promise<FuelSummary>) => async (): Promise<Loaded> => ({ [code]: await load() });

const FEEDS = {
  WA: { states: ["WA"], load: one("WA", loadWa), key: waKey },
  QLD: { states: ["QLD"], load: one("QLD", loadQld), key: qldKey },
  SA: { states: ["SA"], load: one("SA", loadSa), key: saKey },
  VIC: { states: ["VIC"], load: one("VIC", loadVic), key: vicKey },
  FUELCHECK: { states: ["NSW", "TAS"], load: loadFuelCheck, key: nswKey },
} satisfies Record<string, Feed>;
export type FuelFeed = keyof typeof FEEDS;
export const FUEL_FEEDS = Object.keys(FEEDS) as FuelFeed[];
export const FUEL_CODES: FuelCode[] = ["NSW", "VIC", "QLD", "WA", "SA", "TAS"];
const feedOf = (code: FuelCode): FuelFeed => FUEL_FEEDS.find((f) => (FEEDS[f].states as FuelCode[]).includes(code))!;

// What the owner has to register for each scheme to go live, or null when it already is. Queensland
// works from the monthly file without one, so its message is advice rather than a failure.
export const keyNeeded = (code: FuelCode) => FEEDS[feedOf(code)].key();
// The same by feed, for the snapshot: a feed that can't run without a key is skipped, not failed.
export const feedKeyNeeded = (feed: FuelFeed) => (feed === "QLD" ? null : FEEDS[feed].key());

// Schemes read through a keyed API. Their free tiers are small (FuelCheck: 2,500 calls a month), so a
// keyed scheme is read at most three times a day and a failure waits the same eight hours before a retry.
const keyed = (feed: FuelFeed) => feed !== "WA" && !(feed === "QLD" && !process.env.FUEL_QLD_KEY);
const HOURS = 3_600;
const revalidateFor = (feed: FuelFeed) => (keyed(feed) ? 8 * HOURS : 24 * HOURS);
const cooldownFor = (feed: FuelFeed) => (keyed(feed) ? 8 * HOURS * 1000 : 20 * 60_000);

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

// Uncached and with every station row: for the snapshot only, which stores the rows itself.
export const loadFuelFeed = (feed: FuelFeed): Promise<Loaded> => FEEDS[feed].load();

// The pages get the summaries only. The station rows for one state run past Next's 2 MB cache
// limit, and an item that big is silently not cached, so every render would fetch again.
// Bump a feed's number after changing its loader, so only that feed is re-read.
const REVISION: Partial<Record<FuelFeed, number>> = { WA: 1 };
const caches = new Map<FuelFeed, (feed: FuelFeed) => Promise<Partial<Record<FuelCode, FuelPage>>>>();
function cached(feed: FuelFeed) {
  if (!caches.has(feed)) {
    const key = ["fuel-prices-v2", `${feed}-${REVISION[feed] ?? 0}`];
    caches.set(feed, unstable_cache(async (f: FuelFeed) => {
      const loaded = await FEEDS[f].load();
      return Object.fromEntries(Object.entries(loaded).map(([code, s]) => [code, forPage(s)]));
    }, key, { revalidate: revalidateFor(feed) }));
  }
  return caches.get(feed)!(feed);
}

// A failed load isn't cached, so without this every page view would retry a source that just refused us.
const failures = new Map<FuelFeed, { at: number; error: string }>();

export async function tryGetFuel(code: FuelCode): Promise<{ data: FuelPage | null; error: string | null }> {
  const feed = feedOf(code);
  // A missing key is not a failure to cache or cool down; it is a fact about the environment.
  const missing = FEEDS[feed].key();
  if (missing && feed !== "QLD") return { data: null, error: missing };
  const recent = failures.get(feed);
  if (recent && Date.now() - recent.at < cooldownFor(feed)) return { data: null, error: `${recent.error} Not retried for ${keyed(feed) ? "eight hours" : "twenty minutes"}.` };
  try {
    const data = (await cached(feed))[code];
    if (!data) throw new Error(`${feed} gave no ${code} figures`);
    failures.delete(feed);
    return { data, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    failures.set(feed, { at: Date.now(), error });
    return { data: null, error };
  }
}
