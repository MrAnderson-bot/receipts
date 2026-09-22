// State and territory contracts. One module per portal, all returning StateSummary.
import { unstable_cache } from "next/cache";
import { loadAct } from "./act";
import { loadNsw } from "./nsw";
import { loadNt } from "./nt";
import { loadQld } from "./qld";
import { loadTas } from "./tas";
import { loadVic } from "./vic";
import { loadWa } from "./wa";
import type { StateSummary } from "./types";

export type { StateSummary, StateContract } from "./types";

const LOADERS = { NSW: loadNsw, VIC: loadVic, QLD: loadQld, WA: loadWa, NT: loadNt, TAS: loadTas, ACT: loadAct } as const;
export type StateCode = keyof typeof LOADERS;
export const STATE_CODES = Object.keys(LOADERS) as StateCode[];

// States with no feed this project can read, and the specific reason for each.
export const NOT_CONNECTED: { name: string; url: string; why: string }[] = [
  {
    name: "South Australia", url: "https://www.tenders.sa.gov.au/contract/search",
    why: "A public register with no download, no contracts dataset on data.sa.gov.au, and a site that only opens for a web browser. It runs the same system as Victoria, so the same hand-gathered snapshot approach would work.",
  },
];

// Queensland alone is more than a hundred files, so each state is read once a day.
// Bump a state's number here after changing its loader, so only that state is re-read.
const REVISION: Partial<Record<StateCode, number>> = { TAS: 2, VIC: 2 };
const caches = new Map<StateCode, (code: StateCode) => Promise<StateSummary>>();
function cached(code: StateCode) {
  if (!caches.has(code)) {
    const key = REVISION[code] ? ["state-contracts-v4", `${code}-${REVISION[code]}`] : ["state-contracts-v4"];
    caches.set(code, unstable_cache((c: StateCode) => LOADERS[c](), key, { revalidate: 86_400 }));
  }
  return caches.get(code)!(code);
}

// A failed load isn't cached, so without this every page view would retry a source that just refused us.
const COOLDOWN = 20 * 60_000;
const failures = new Map<StateCode, { at: number; error: string }>();

export async function tryGetState(code: StateCode): Promise<{ data: StateSummary | null; error: string | null }> {
  const recent = failures.get(code);
  if (recent && Date.now() - recent.at < COOLDOWN) return { data: null, error: `${recent.error} Trying again shortly.` };
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
