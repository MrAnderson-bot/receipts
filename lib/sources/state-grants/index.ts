// State and territory grant payments. One module per feed, all returning
// StateGrantSummary. Only Queensland publishes a whole-of-government file;
// the rest are listed in NOT_CONNECTED with the specific reason.
import { unstable_cache } from "next/cache";
import { getStore } from "../../db";
import { loadQldGrants } from "./qld";
import { loadWaGrants } from "./wa";
import type { StateGrantSummary, StateGrantsLoad } from "./types";

export type { StateGrantSummary, StateGrant, StateGrantRow, StateGrantCode, StateGrantsLoad } from "./types";

// Full loads return the rows too, for the database; pages only ever see the summary.
// NSW is walked incrementally by the nightly job (see nsw.ts), so the page only ever reads its stored
// snapshot; there is no live load for it.
const FULL: Record<"QLD" | "WA", () => Promise<StateGrantsLoad>> = { QLD: loadQldGrants, WA: loadWaGrants };
const LOADERS = {
  NSW: async (): Promise<StateGrantSummary> => { throw new Error("NSW grants are read from the nightly snapshot only; none has been taken yet. Run npm run snapshot."); },
  QLD: async () => (await loadQldGrants()).summary,
  WA: async () => (await loadWaGrants()).summary,
} as const;
const STORED_ONLY = new Set<ConnectedCode>(["NSW"]);
export type ConnectedCode = keyof typeof LOADERS;
export const STATE_GRANT_CODES = Object.keys(LOADERS) as ConnectedCode[];
export const loadStateGrantsFull = (code: Exclude<ConnectedCode, "NSW">) => FULL[code]();

// Jurisdictions with no feed this project can read, and why. Each was probed endpoint by endpoint on
// 25 September 2026; the evidence is summarised in README.md under "Things to know about state grants".
export const NOT_CONNECTED: { name: string; url: string; why: string }[] = [
  {
    name: "Victorian grants awarded", url: "https://www.vic.gov.au/grants-and-programs",
    why: "The grants and programs finder is an opportunities index: its 171 grant records carry open and close dates, a funding range and a department, but no recipients or amounts awarded. Recipients are published as hand-written pages program by program, and the only award lists on data.vic.gov.au are single funds, the newest a 2020-21 Sustainability Fund file.",
  },
  {
    name: "Western Australian departmental grants", url: "https://www.wa.gov.au/service/community-services/grants-and-subsidies",
    why: "A directory of programs, not of awards: no grants dataset on data.wa.gov.au, no departmental list of recipients, and wa.gov.au’s content API refuses non-browser clients. Lotterywest’s approved grants are on this page; the State’s departments are not.",
  },
  {
    name: "South Australian grants awarded", url: "https://data.sa.gov.au/data/dataset?q=grants",
    why: "No central finder or register. data.sa.gov.au holds only single-program recipient lists (Grants SA, Multicultural Grants, Community Services Support Program, SAFC), the newest from 2019-20, and treasury.sa.gov.au, sa.gov.au, dpc.sa.gov.au and dhs.sa.gov.au all sit behind a Cloudflare challenge that refuses non-browser clients, so even department recipient pages cannot be read automatically.",
  },
  {
    name: "Tasmanian grants awarded", url: "https://www.treasury.tas.gov.au/budget-and-financial-management/guidelines-instructions-and-legislation/fma-treasurers-instructions",
    why: "No whole-of-government register or dataset: Treasurer’s Instruction FC-12 leaves grant reporting to each agency’s annual report, data.gov.au holds no Tasmanian grants list, and the pages where Business Tasmania, Arts Tasmania, Active Tasmania, State Growth and Service Tasmania list recipients sit behind a Cloudflare challenge that refuses automated readers.",
  },
  {
    name: "ACT grants awarded", url: "https://www.act.gov.au/open/administration-of-government-grants-in-the-act",
    why: "The ACT’s grants policy requires each directorate to publish its own awards on its own website. grants.act.gov.au is a directory of open opportunities, the only grant datasets on data.act.gov.au are two anonymised COVID-19 business-support tables from 2022, and grant payments are not in the invoices register.",
  },
  {
    name: "Northern Territory grants awarded", url: "https://grantsnt.nt.gov.au/grants",
    why: "GrantsNT’s public search API returns only the 46 open or upcoming rounds, with agency, dates and eligibility. Awarded grants exist solely in each recipient’s login-only portal, a grant’s page has no recipients section, there is no grants dataset on data.nt.gov.au, and nt.gov.au’s grants directory sits behind a Cloudflare challenge.",
  },
];

// One file of tens of thousands of rows, so each feed is read once a day.
// Bump the number after changing a loader so only that feed is re-read.
const REVISION: Partial<Record<ConnectedCode, number>> = {};
const caches = new Map<ConnectedCode, () => Promise<StateGrantSummary>>();
function cached(code: ConnectedCode) {
  if (!caches.has(code)) {
    const key = ["state-grants-v1", `${code}-${REVISION[code] ?? 0}`];
    caches.set(code, unstable_cache(LOADERS[code], key, { revalidate: 86_400 }));
  }
  return caches.get(code)!();
}

// A failed load isn't cached, so without this every page view would retry a source that just refused us.
const COOLDOWN = 20 * 60_000;
const failures = new Map<ConnectedCode, { at: number; error: string }>();

export async function tryGetStateGrants(code: ConnectedCode): Promise<{ data: StateGrantSummary | null; error: string | null }> {
  const recent = failures.get(code);
  if (recent && Date.now() - recent.at < COOLDOWN) return { data: null, error: `${recent.error} Trying again shortly.` };
  if (STORED_ONLY.has(code)) {
    try {
      const [latest] = await getStore().snapshots("state-grants", code, 1);
      if (latest) return { data: latest.payload as StateGrantSummary, error: null };
    } catch (e) {
      return { data: null, error: `No database to read the ${code} snapshot from (${e instanceof Error ? e.message : String(e)}).` };
    }
  }
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
