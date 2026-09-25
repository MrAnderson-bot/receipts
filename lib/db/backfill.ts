// Fills the database with history, one unit at a time, resumably. A unit is one source for one
// financial year. Progress is kept in backfill_progress so a unit that stops part way (time budget,
// network, Ctrl-C) carries on from its cursor next time. See docs/backfill.md for the plan and
// docs/query-audit.md for why contracts are read from contractLastModified.
import { getStore } from "./index";
import type { BackfillProgress } from "./types";
import { fetchReleases, toReleases, type Release } from "../sources/austender";
import { toContracts } from "../sources/austender";

const DAY = 86_400_000;
const WINDOW_DAYS = 7;

export type BackfillOptions = {
  minutes?: number; // time budget; the unit stops cleanly at the next window boundary
  log?: (line: string) => void;
};

// "FY2025-26" -> 1 July 2025 to 30 June 2026 (end exclusive, in UTC; the API takes UTC timestamps).
export function financialYear(unit: string): { from: Date; to: Date } {
  const m = unit.match(/FY(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Unit "${unit}" needs a financial year like FY2025-26`);
  const start = Number(m[1]);
  return { from: new Date(Date.UTC(start, 6, 1)), to: new Date(Date.UTC(start + 1, 6, 1)) };
}

// Contracts for one financial year: every release (original notices and amendments) the API says was
// last modified inside the year, walked in 7-day windows from the end of the year backwards, so the
// newest notices land first. Each window's releases go to contract_releases; the original notices among
// them also go to the contracts table so the notice-page crawl picks them up.
async function contractsUnit(unit: string, opts: BackfillOptions): Promise<BackfillProgress> {
  const store = getStore();
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + (opts.minutes ?? 20) * 60_000;
  const { from, to } = financialYear(unit);
  const started = new Date().toISOString();
  const prev = await store.backfillProgress(unit);
  if (prev?.status === "done") { log(`${unit}: already done (${prev.rowsAdded} rows)`); return prev; }
  const p: BackfillProgress = {
    unit, status: "running", cursor: prev?.cursor ?? null, rowsAdded: prev?.rowsAdded ?? 0, calls: prev?.calls ?? 0,
    started: prev?.started ?? started, finished: null, error: null,
  };
  await store.saveBackfillProgress(p);

  // The cursor is the start of the last window completed; windows run from `to` back towards `from`.
  let end = p.cursor ? new Date(p.cursor) : to;
  const capped = Math.min(to.getTime(), Date.now());
  if (end.getTime() > capped) end = new Date(capped);
  try {
    while (end.getTime() > from.getTime()) {
      if (Date.now() > deadline) { log(`${unit}: time budget reached at ${end.toISOString().slice(0, 10)}; resume later`); break; }
      const start = new Date(Math.max(from.getTime(), end.getTime() - WINDOW_DAYS * DAY));
      const { releases, pages } = await fetchReleases("contractLastModified", start, end);
      p.calls += pages;
      const rows: Release[] = releases.flatMap(toReleases);
      // The same release can come back on two pages of one window; keep one copy.
      const unique = [...new Map(rows.map((r) => [`${r.releaseId}|${r.cnId}`, r])).values()];
      const { added } = await store.saveReleases(unique);
      const originals = releases.filter((r: any) => !(r.tag ?? []).includes("contractAmendment"));
      const contracts = originals.flatMap((r: any) => toContracts(r).filter((c) => !c.amendment).map(({ amendment, ...c }) => c));
      const { added: newContracts } = await store.saveContracts(contracts);
      p.rowsAdded += added;
      p.cursor = start.toISOString();
      await store.saveBackfillProgress(p);
      log(`${unit}: ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}: ${unique.length} releases (${added} new), ${contracts.length} originals (${newContracts} new), ${pages} pages`);
      end = start;
    }
    if (end.getTime() <= from.getTime()) { p.status = "done"; p.finished = new Date().toISOString(); }
  } catch (e) {
    p.status = "failed"; p.error = e instanceof Error ? e.message : String(e);
    await store.saveBackfillProgress(p);
    throw e;
  }
  await store.saveBackfillProgress(p);
  return p;
}

export async function runBackfill(unit: string, opts: BackfillOptions = {}): Promise<BackfillProgress> {
  if (unit.startsWith("contracts:")) return contractsUnit(unit, opts);
  throw new Error(`Unknown backfill unit "${unit}". Known: contracts:FY<yyyy-yy>`);
}
