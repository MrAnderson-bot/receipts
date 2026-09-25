// Fills the database with history, one unit at a time, resumably. A unit is one source for one
// financial year, or one source for every release it has ("all" units). Progress is kept in
// backfill_progress so a unit that stops part way (time budget, network, Ctrl-C) carries on from
// its cursor next time. See docs/backfill.md for the plan and docs/query-audit.md for why
// contracts are read from contractLastModified.
//
// Units:
//   contracts:FY<yyyy-yy>   every AusTender release last modified in the year, 7-day windows, newest first
//   grants:FY<yyyy-yy>      every GrantConnect award published in the year, month by month, newest first
//   series:depth            every ABS, RBA and AOFM series from the earliest period the publisher offers
//   gfs:all | gfs:<yyyy-yy> Commonwealth expenses by purpose from each ABS Government Finance Statistics release
//   budget:all | budget:<yyyy-yy>   each Budget's program expense lines and portfolio totals as that Budget estimated them
//   companies:all | companies:<yyyy-yy>   the ATO transparency list for each income year
//   ipea:all | ipea:<yyyy>Q<qq>     parliamentarians' expenses, each quarterly extract
//   aps:all | aps:<yyyy-mm-dd>      APS headcount, each half-yearly release
//
// Everything here runs in plain Node (scripts/backfill.mjs), so it calls each source's raw loader, never
// the Next-cached one: unstable_cache only works inside a Next process.
import { getStore } from "./index";
import type { BackfillProgress } from "./types";
import { fetchReleases, toReleases, type Release } from "../sources/austender";
import { toContracts } from "../sources/austender";
import { loadGrantRows } from "../sources/grantconnect";
import { ABS_SERIES, fetchAbs } from "../sources/abs";
import { RBA_SERIES, fetchRba } from "../sources/rba";
import { fetchAgs } from "../sources/aofm";
import { DERIVED } from "../derived";
import { loadGfsExpenses } from "../sources/abs-gfs";
import { listBudgetDatasets, loadBudget, loadBudgetPrograms } from "../sources/budget";
import { listFiles as listAtoFiles, readYear as readAtoYear } from "../sources/ato-transparency";
import { listQuarters, readQuarter } from "../sources/ipea";
import { findReleases as findApsReleases, loadRelease as loadApsRelease } from "../sources/apsc";
import type { Series } from "../sources/types";

const DAY = 86_400_000;
const WINDOW_DAYS = 7;

export type BackfillOptions = {
  minutes?: number; // time budget; the unit stops cleanly at the next window boundary
  log?: (line: string) => void;
};

type Log = (line: string) => void;

// "FY2025-26" -> 1 July 2025 to 30 June 2026 (end exclusive, in UTC; the API takes UTC timestamps).
export function financialYear(unit: string): { from: Date; to: Date } {
  const m = unit.match(/FY(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Unit "${unit}" needs a financial year like FY2025-26`);
  const start = Number(m[1]);
  return { from: new Date(Date.UTC(start, 6, 1)), to: new Date(Date.UTC(start + 1, 6, 1)) };
}

// Progress bookkeeping shared by every unit: load or start the row, save it, mark done or failed.
async function begin(unit: string, log: Log): Promise<{ p: BackfillProgress; skip: boolean }> {
  const store = getStore();
  const prev = await store.backfillProgress(unit);
  if (prev?.status === "done") { log(`${unit}: already done (${prev.rowsAdded} rows)`); return { p: prev, skip: true }; }
  const p: BackfillProgress = {
    unit, status: "running", cursor: prev?.cursor ?? null, rowsAdded: prev?.rowsAdded ?? 0, calls: prev?.calls ?? 0,
    started: prev?.started ?? new Date().toISOString(), finished: null, error: null,
  };
  await store.saveBackfillProgress(p);
  return { p, skip: false };
}
async function finish(p: BackfillProgress, done: boolean) {
  if (done) { p.status = "done"; p.finished = new Date().toISOString(); }
  await getStore().saveBackfillProgress(p);
  return p;
}
async function fail(p: BackfillProgress, e: unknown): Promise<never> {
  p.status = "failed"; p.error = e instanceof Error ? e.message : String(e);
  await getStore().saveBackfillProgress(p);
  throw e;
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
  const { p, skip } = await begin(unit, log);
  if (skip) return p;

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
  } catch (e) { await fail(p, e); }
  return finish(p, end.getTime() <= from.getTime());
}

// Grants for one financial year: the published-grants report a month at a time, newest month first.
// The cursor is the start of the last month completed.
async function grantsUnit(unit: string, opts: BackfillOptions): Promise<BackfillProgress> {
  const store = getStore();
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + (opts.minutes ?? 20) * 60_000;
  const { from, to } = financialYear(unit);
  const { p, skip } = await begin(unit, log);
  if (skip) return p;
  let end = p.cursor ? new Date(p.cursor) : to;
  if (end.getTime() > Date.now()) end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  try {
    while (end.getTime() > from.getTime()) {
      if (Date.now() > deadline) { log(`${unit}: time budget reached at ${end.toISOString().slice(0, 10)}; resume later`); break; }
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
      const rows = await loadGrantRows(start, new Date(end.getTime() - DAY));
      p.calls += 1;
      const { added } = await store.saveGrants(rows);
      p.rowsAdded += added;
      p.cursor = start.toISOString();
      await store.saveBackfillProgress(p);
      log(`${unit}: ${start.toISOString().slice(0, 7)}: ${rows.length} awards (${added} new)`);
      end = start;
      await new Promise((r) => setTimeout(r, 2000)); // one report at a time, politely
    }
  } catch (e) { await fail(p, e); }
  return finish(p, end.getTime() <= from.getTime());
}

// Every ABS, RBA and AOFM series from the earliest period the publisher offers, then the derived
// series rebuilt from them. Idempotent: existing periods are kept, revisions recorded as usual.
async function seriesDepthUnit(unit: string, opts: BackfillOptions): Promise<BackfillProgress> {
  const store = getStore();
  const log = opts.log ?? (() => {});
  const { p, skip } = await begin(unit, log);
  if (skip) return p;
  try {
    const got = new Map<string, Series>();
    const jobs: { id: string; run: () => Promise<Series> }[] = [
      ...ABS_SERIES.map((s) => ({ id: s.id, run: () => fetchAbs({ ...s, from: "1970" }) })),
      ...RBA_SERIES.map((s) => ({ id: s.id, run: () => fetchRba({ ...s, from: "1900-01-01" }) })),
      { id: "ags-on-issue", run: () => fetchAgs() },
    ];
    for (const j of jobs) {
      try {
        const s = await j.run();
        got.set(j.id, s);
        const { added, revised } = await store.saveSeries(s);
        p.rowsAdded += added; p.calls += 1;
        log(`${unit}: ${j.id}: ${s.points.length} points from ${s.points[0]?.period}, ${added} new, ${revised} revised`);
      } catch (e) {
        log(`${unit}: ${j.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const d of DERIVED) {
      const inputs = d.inputs.map((id) => got.get(id));
      if (inputs.some((s) => !s)) { log(`${unit}: ${d.id}: skipped, needs ${d.inputs.join(", ")}`); continue; }
      const s = d.build(inputs as Series[]);
      const { added } = await store.saveSeries(s);
      p.rowsAdded += added;
      log(`${unit}: ${d.id}: ${s.points.length} points from ${s.points[0]?.period}, ${added} new`);
    }
  } catch (e) { await fail(p, e); }
  return finish(p, true);
}

// Units that walk a list of releases (newest first) within the time budget, remembering which are done.
// The cursor is a JSON list of finished item ids, so a run that stops part way resumes without repeats.
async function eachRelease<T>(unit: string, opts: BackfillOptions, items: () => Promise<{ id: string; item: T }[]>,
  one: (item: T, p: BackfillProgress, log: Log) => Promise<number>): Promise<BackfillProgress> {
  const store = getStore();
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + (opts.minutes ?? 20) * 60_000;
  const { p, skip } = await begin(unit, log);
  if (skip) return p;
  let done: string[] = [];
  try { done = p.cursor ? JSON.parse(p.cursor) : []; } catch { done = []; }
  let all: { id: string; item: T }[];
  try { all = await items(); p.calls += 1; } catch (e) { return fail(p, e); }
  let stopped = false;
  for (const { id, item } of all) {
    if (done.includes(id)) continue;
    if (Date.now() > deadline) { log(`${unit}: time budget reached before ${id}; resume later`); stopped = true; break; }
    try {
      const added = await one(item, p, log);
      p.rowsAdded += added; p.calls += 1;
      done.push(id);
      p.cursor = JSON.stringify(done);
      await store.saveBackfillProgress(p);
    } catch (e) {
      // One unreadable release (an old layout, a dead link) is logged and skipped, not fatal.
      log(`${unit}: ${id}: ${e instanceof Error ? e.message : String(e)}`);
      done.push(id);
      p.cursor = JSON.stringify(done);
      await store.saveBackfillProgress(p);
    }
  }
  return finish(p, !stopped);
}

// Only add periods a series doesn't already have. Used where older releases restate years a newer
// release already gave: the newer figure stays current and the older one never overwrites it.
async function saveNewPeriodsOnly(s: Series): Promise<number> {
  const store = getStore();
  const have = new Set((await store.seriesHistory(s.id)).map((pt) => pt.period));
  const fresh = s.points.filter((pt) => !have.has(pt.period));
  if (fresh.length === 0) return 0;
  const { added } = await store.saveSeries({ ...s, points: fresh });
  return added;
}

// GFS: one release per item, newest first. The latest release's figures are saved in full; older
// releases only add the years the newer ones don't cover.
const gfsUnit = (unit: string, opts: BackfillOptions) => eachRelease<string | undefined>(unit, opts,
  async () => {
    const only = unit.match(/^gfs:(\d{4}-\d{2})$/)?.[1];
    if (only) return [{ id: only, item: only }];
    const latest = await loadGfsExpenses();
    const start = Number(latest.releaseYear.slice(0, 4));
    // Release years back to 2015-16 (the first on the current ABS site); earlier ones fail and are skipped.
    const years = Array.from({ length: start - 2015 + 1 }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
    return years.map((y) => ({ id: y, item: y === latest.releaseYear ? undefined : y }));
  },
  async (year, p, log) => {
    const d = await loadGfsExpenses(year);
    let added = 0;
    for (const s of [d.total, ...d.purposes.map((x) => x.series)]) added += await saveNewPeriodsOnly(s);
    await getStore().saveSnapshot("gfs", d.releaseYear, { ...d, purposes: d.purposes.map((x) => ({ name: x.name, parent: x.parent, id: x.series.id })) });
    log(`${unit}: release ${d.releaseYear}: ${d.years[0]} to ${d.years[d.years.length - 1]}, ${d.purposes.length} purposes, ${added} new points`);
    return added;
  });

// Past Budgets: every program expense line as that Budget published it (snapshot budget-programs/<year>),
// and each portfolio's expenses as that Budget estimated them, one series per portfolio and Budget. The
// Budget Paper 1 tables (expenses by function, the historical totals) are read for the current Budget only:
// older zips don't carry them, and the historical totals are already stored from the current tables.
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const budgetUnit = (unit: string, opts: BackfillOptions) => eachRelease<string>(unit, opts,
  async () => {
    const only = unit.match(/^budget:(\d{4}-\d{2})$/)?.[1];
    const years = only ? [only] : (await listBudgetDatasets()).map((d) => d.year);
    return years.map((y) => ({ id: y, item: y }));
  },
  async (year, p, log) => {
    const store = getStore();
    const b = await loadBudgetPrograms(year);
    await store.saveSnapshot("budget-programs", b.budgetYear, b);
    let added = 0;
    for (const pf of b.byPortfolio) {
      const { added: n } = await store.saveSeries({
        id: `budget-portfolio:${slugOf(pf.name)}:as-at-${b.budgetYear}`, label: `${pf.name} portfolio expenses, as estimated in the ${b.budgetYear} Budget`,
        unit: "AUD", frequency: "yearly", decimals: 0,
        note: `Program expenses of the ${pf.name} portfolio for each year, as the ${b.budgetYear} Budget's Portfolio Budget Statements estimated them (administered and departmental expense lines, $'000 as published, converted to dollars). Estimates as at that Budget, never revised here.`,
        source: `Department of Finance, Budget ${b.budgetYear} Portfolio Budget Statements`, sourceUrl: b.datasetUrl,
        points: b.years.map((y) => ({ period: `FY${y}`, value: pf.values[y] ?? 0 })),
      });
      added += n;
    }
    // The current Budget's Paper 1 tables as well, so the dated budget snapshot exists for it.
    try {
      const current = (await listBudgetDatasets())[0]?.year;
      if (current === year) await store.saveSnapshot("budget", year, await loadBudget(year));
    } catch (e) { log(`${unit}: ${year}: Budget Paper 1 tables not stored: ${e instanceof Error ? e.message : String(e)}`); }
    log(`${unit}: Budget ${b.budgetYear}: ${b.lines.length} program lines, ${b.byPortfolio.length} portfolios, years ${b.years[0]} to ${b.years[b.years.length - 1]}, ${added} new points`);
    return added;
  });

// Companies: one ATO transparency spreadsheet per income year, every row, late entries tagged with their own year.
const companiesUnit = (unit: string, opts: BackfillOptions) => eachRelease<{ name: string; url: string }>(unit, opts,
  async () => {
    const only = unit.match(/^companies:(\d{4}-\d{2})$/)?.[1];
    const files = await listAtoFiles();
    return files.filter((f) => !only || f.name.startsWith(only)).map((f) => ({ id: f.name.slice(0, 7), item: f }));
  },
  async (f, p, log) => {
    const y = await readAtoYear(f.url);
    const year = y.year || f.name.slice(0, 7);
    const rows = [...y.entities, ...y.late].map((e) => ({ abn: e.abn, name: e.name, incomeYear: e.incomeYear || year, income: e.income, taxable: e.taxable, tax: e.tax }));
    const saved = await getStore().saveCompanies(rows);
    log(`${unit}: ${year}: ${saved} companies`);
    return saved;
  });

// IPEA: one quarterly extract per item.
const ipeaUnit = (unit: string, opts: BackfillOptions) => eachRelease(unit, opts,
  async () => {
    const only = unit.match(/^ipea:(\d{4}Q\d{2})$/)?.[1];
    return (await listQuarters()).filter((q) => !only || q.id === only).map((q) => ({ id: q.id, item: q }));
  },
  async (q, p, log) => {
    const { quarter, rows } = await readQuarter(q);
    const { added } = await getStore().saveExpenses(rows);
    log(`${unit}: ${quarter.id} (${quarter.period}): ${rows.length} lines, ${added} new`);
    return added;
  });

// APS headcount: one half-yearly release per item.
const apsUnit = (unit: string, opts: BackfillOptions) => eachRelease(unit, opts,
  async () => {
    const only = unit.match(/^aps:(\d{4}-\d{2}-\d{2})$/)?.[1];
    return (await findApsReleases()).filter((f) => !only || f.date === only).map((f) => ({ id: f.date, item: f }));
  },
  async (f, p, log) => {
    const { rows, release } = await loadApsRelease(f);
    const { added } = await getStore().saveApsHeadcount(rows);
    log(`${unit}: ${release.label}: ${rows.length} rows, ${added} new`);
    return added;
  });

export async function runBackfill(unit: string, opts: BackfillOptions = {}): Promise<BackfillProgress> {
  if (unit.startsWith("contracts:")) return contractsUnit(unit, opts);
  if (unit.startsWith("grants:")) return grantsUnit(unit, opts);
  if (unit === "series:depth") return seriesDepthUnit(unit, opts);
  if (unit.startsWith("gfs:")) return gfsUnit(unit, opts);
  if (unit.startsWith("budget:")) return budgetUnit(unit, opts);
  if (unit.startsWith("companies:")) return companiesUnit(unit, opts);
  if (unit.startsWith("ipea:")) return ipeaUnit(unit, opts);
  if (unit.startsWith("aps:")) return apsUnit(unit, opts);
  throw new Error(`Unknown backfill unit "${unit}". Known: contracts:FY<yyyy-yy>, grants:FY<yyyy-yy>, series:depth, gfs:all, budget:all, companies:all, ipea:all, aps:all (or one release: gfs:2019-20, budget:2019-20, companies:2016-17, ipea:2019Q03, aps:2019-12-31)`);
}
