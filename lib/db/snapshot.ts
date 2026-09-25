// Reads every feed once and stores the result. Run daily. Each source is saved
// on its own, so one that is down doesn't stop the rest.
import { getStore, type RunResult } from "./index";
import { getIndicators } from "../economy";
import { tryGetSummary, fetchNotice, RANGES } from "../sources/austender";
import { tryGetGrants } from "../sources/grantconnect";
import { tryGetRevenue } from "../sources/treasury";
import { tryGetTaxByLevel } from "../sources/abs-tax";
import { tryGetBudget } from "../sources/budget";
import { tryGetTransparency, loadAllEntities } from "../sources/ato-transparency";
import { tryGetProfits } from "../sources/abs-profits";
import { tryGetState, STATE_CODES } from "../sources/states";
import { loadFuelFeed, keyNeeded, FUEL_FEEDS } from "../sources/fuel";
import { tryGetMigration } from "../sources/migration";
import { tryGetCrime } from "../sources/crime";
import { tryGetHomelessness } from "../sources/homelessness";
import { tryGetAssetSales } from "../sources/finance-sales";
import { loadAps } from "../sources/apsc";
import { loadQuarters, summarise as summariseExpenses } from "../sources/ipea";
import type { Series } from "../sources/types";
import type { YearValue } from "../sources/treasury";

// Financial-year figures stored as series, so the model can read them the same way as ABS and RBA data.
function yearly(id: string, label: string, unit: Series["unit"], source: string, sourceUrl: string, values: YearValue[], scale = 1): Series {
  return {
    id, label, unit, frequency: "yearly", note: "Final outcomes only; Budget estimates are not stored as observations.", source, sourceUrl,
    points: values.filter((v) => !v.estimate).map((v) => ({ period: `FY${v.year}`, value: v.value * scale })),
  };
}

export async function runSnapshot(): Promise<RunResult[]> {
  const store = getStore();
  const runId = await store.startRun();
  const results: RunResult[] = [];
  const step = async (source: string, work: () => Promise<string>) => {
    try { results.push({ source, ok: true, detail: await work() }); }
    catch (e) { results.push({ source, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
  };
  // The loaders return { data, error } instead of throwing, so turn an error back into a failure here.
  const need = <T>(r: { data: T | null; error: string | null }): T => {
    if (!r.data) throw new Error(r.error ?? "no data");
    return r.data;
  };

  for (const r of await getIndicators()) {
    await step(`series:${r.id}`, async () => {
      if (!r.series) throw new Error(r.error ?? "no data");
      const { added, revised } = await store.saveSeries(r.series);
      return `${added} new, ${revised} revised`;
    });
  }

  await step("revenue", async () => {
    const d = need(await tryGetRevenue());
    const M = 1_000_000, src = "Treasury, Budget Paper No. 1, Statement 5", url = "https://budget.gov.au/content/bp1/index.htm";
    await store.saveSeries(yearly("revenue-total", "Commonwealth receipts", "AUD", src, url, d.total, M));
    await store.saveSeries(yearly("revenue-share-gdp", "Commonwealth receipts, share of GDP", "%", src, url, d.shareOfGdp));
    for (const line of d.lines) {
      await store.saveSeries(yearly(`revenue:${line.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, line.name, "AUD", src, url, line.series, M));
    }
    await store.saveSnapshot("revenue", "latest", d);
    return `${d.lines.length + 2} series to ${d.latestActual}`;
  });

  await step("budget", async () => {
    const d = need(await tryGetBudget());
    const M = 1_000_000, src = "Department of Finance, Budget tables";
    await store.saveSeries(yearly("budget-payments", "Commonwealth payments", "AUD", src, d.datasetUrl, d.payments, M));
    await store.saveSeries(yearly("budget-balance", "Underlying cash balance", "AUD", src, d.datasetUrl, d.balance, M));
    await store.saveSeries(yearly("budget-balance-share-gdp", "Underlying cash balance, share of GDP", "%", src, d.datasetUrl, d.balanceShare));
    await store.saveSeries(yearly("net-debt", "Commonwealth net debt", "AUD", src, d.datasetUrl, d.netDebt, M));
    await store.saveSeries(yearly("net-debt-share-gdp", "Commonwealth net debt, share of GDP", "%", src, d.datasetUrl, d.netDebtShare));
    await store.saveSeries(yearly("net-interest", "Commonwealth net interest payments", "AUD", src, d.datasetUrl, d.netInterest, M));
    await store.saveSeries(yearly("net-interest-share-gdp", "Commonwealth net interest payments, share of GDP", "%", src, d.datasetUrl, d.netInterestShare));
    await store.saveSeries(yearly("budget-receipts-share-gdp", "Commonwealth receipts, share of GDP (Budget tables)", "%", src, d.datasetUrl, d.receiptsShare));
    await store.saveSeries(yearly("budget-payments-real-growth", "Commonwealth payments, real growth", "%", src, d.datasetUrl, d.paymentsRealGrowth));
    await store.saveSeries(yearly("net-capital-investment", "Commonwealth net capital investment", "AUD", src, d.datasetUrl, d.netCapitalInvestment, M));
    await store.saveSeries(yearly("net-capital-investment-share-gdp", "Commonwealth net capital investment, share of GDP", "%", src, d.datasetUrl, d.netCapitalInvestmentShare));
    // Estimates change with every Budget, so they are kept whole in the snapshot, dated by when they were read.
    await store.saveSnapshot("budget", d.budgetYear, d);
    return `11 series, ${d.budgetYear} Budget`;
  });

  await step("asset-sales", async () => {
    const d = need(await tryGetAssetSales());
    // The list only ever grows, but a sale's stated proceeds can be corrected, so the whole list is kept per day.
    await store.saveSnapshot("asset-sales", "all", d);
    return `${d.sales.length} sales`;
  });

  await step("tax-by-level", async () => {
    const d = need(await tryGetTaxByLevel());
    await store.saveSnapshot("tax-by-level", d.latest, d);
    return `to ${d.latest}`;
  });

  await step("company-profits", async () => {
    const d = need(await tryGetProfits());
    await store.saveSnapshot("company-profits", d.quarter, d);
    return d.quarter;
  });

  await step("companies", async () => {
    const summary = need(await tryGetTransparency());
    await store.saveSnapshot("companies", summary.year, summary);
    const all = await loadAllEntities();
    const saved = await store.saveCompanies(all.entities.map((e) => ({ abn: e.abn, name: e.name, incomeYear: e.incomeYear || all.year, income: e.income, taxable: e.taxable, tax: e.tax })));
    return `${saved} companies, ${all.year}`;
  });

  for (const days of RANGES) {
    await step(`contracts:${days}d`, async () => {
      // The summary is kept without the list; the list goes into the contracts table, one row each.
      const { contracts, ...summary } = need(await tryGetSummary(days));
      await store.saveSnapshot("contracts", `${days}d`, { ...summary, contractCount: contracts.length });
      const { added } = days === Math.max(...RANGES) ? await store.saveContracts(contracts) : { added: 0 };
      return `${contracts.length} contracts${added ? `, ${added} new rows` : ""}`;
    });
    await step(`grants:${days}d`, async () => {
      const d = need(await tryGetGrants(days));
      await store.saveSnapshot("grants", `${days}d`, d);
      return `${d.count} grants`;
    });
  }

  // Parliamentarians' expenses: the summary is kept as a snapshot and every line goes into its own table.
  await step("ipea-expenses", async () => {
    const loaded = await loadQuarters();
    const summary = summariseExpenses(loaded);
    await store.saveSnapshot("ipea-expenses", summary.latest.id, summary);
    const rows = loaded.flatMap((l) => l.rows);
    const { added } = await store.saveExpenses(rows);
    return `${rows.length} lines across ${loaded.length} quarters to ${summary.latest.period}, ${added} new rows`;
  });

  // Read the notice page for contracts that don't have it yet, newest first. The API leaves out the
  // fields the page shows, so this is what makes a stored record match the public one. Politely:
  // two pages at a time, a pause between, and a budget per run (NOTICE_BUDGET, default 1500).
  await step("contract-notices", async () => {
    const budget = Number(process.env.NOTICE_BUDGET ?? 1500);
    const todo = await store.contractsWithoutNotice(budget);
    let read = 0, failed = 0, i = 0;
    const errors: string[] = [];
    await Promise.all([0, 1].map(async () => {
      while (i < todo.length) {
        const { id, pageId } = todo[i++];
        try { await store.saveNotice(id, await fetchNotice(pageId)); read++; }
        catch (e) { failed++; if (errors.length < 3) errors.push(`${id}: ${e instanceof Error ? e.message : e}`); }
        await new Promise((r) => setTimeout(r, 400));
      }
    }));
    return `${read} read, ${failed} failed${errors.length ? ` (${errors.join("; ")})` : ""}, ${todo.length === budget ? "budget used" : "caught up"}`;
  });

  // Migration: each file is its own step, and every series it yields is stored so revisions stay visible.
  const migration = await tryGetMigration();
  const migrationParts: [string, { data: any; error: string | null }, (d: any) => { series: import("../sources/types").Series[]; key: string }][] = [
    ["temp-visa-holders", migration.tempHolders, (d) => ({ series: [d.series], key: d.latest.date })],
    ["skilled-visas", migration.skilled, (d) => ({ series: [d.series], key: d.latest.year.year })],
    ["working-holiday", migration.whm, (d) => ({ series: [d.series], key: d.latest.year.year })],
    ["permanent-program", migration.permanent, (d) => ({ series: [d.series], key: d.latest.year })],
    ["migration-package", migration.package, (d) => ({ series: [d.program.series, d.tempGranted.series], key: d.citizenship.year })],
    ["net-overseas-migration", migration.nom, (d) => ({ series: [d.series, d.arrivals, d.departures], key: d.latest.year })],
  ];
  for (const [name, part, pick] of migrationParts) {
    await step(`migration:${name}`, async () => {
      const d = need(part);
      const { series, key } = pick(d);
      for (const s of series) await store.saveSeries(s);
      await store.saveSnapshot(`migration:${name}`, key, d);
      return `${series.length} series, ${key}`;
    });
  }

  // Crime and homelessness: every series stored, plus the whole table set as a dated snapshot.
  const [crime, homelessness] = await Promise.all([tryGetCrime(), tryGetHomelessness()]);
  const yearlyParts: [string, { data: any; error: string | null }, (d: any) => string][] = [
    ["crime:victims", crime.victims, (d) => d.edition],
    ["crime:offenders", crime.offenders, (d) => d.edition],
    ["homelessness:shs", homelessness.shs, (d) => d.latestYear],
    ["homelessness:census", homelessness.census, (d) => d.years[d.years.length - 1]],
  ];
  for (const [name, part, keyOf] of yearlyParts) {
    await step(name, async () => {
      const d = need(part);
      for (const s of d.series as Series[]) await store.saveSeries(s);
      await store.saveSnapshot(name, keyOf(d), d);
      return `${d.series.length} series, ${keyOf(d)}`;
    });
  }
  // APS headcount: every cell of the agency-by-gender-by-classification table, one row each, plus the twenty-year totals.
  await step("aps", async () => {
    const d = await loadAps(); // uncached: the rows are too big for the page cache
    const { added } = await store.saveApsHeadcount(d.rows);
    for (const s of [d.history.total, d.history.men, d.history.women]) await store.saveSeries(s);
    const { rows, ...summary } = d;
    await store.saveSnapshot("aps", d.latest.date, summary);
    return `${d.releases.length} releases, ${rows.length} rows (${added} new), latest ${d.latest.label}${d.skipped.length ? `; skipped ${d.skipped.join("; ")}` : ""}`;
  });

  for (const code of STATE_CODES) {
    await step(`state:${code}`, async () => {
      const d = need(await tryGetState(code));
      await store.saveSnapshot("state", code, d);
      return `${d.count} ${d.noun}`;
    });
  }

  // Fuel: one uncached load per feed (the station rows are too big for the page cache), then the
  // state-level figures are kept daily as a snapshot and the station rows replace yesterday's.
  for (const feed of FUEL_FEEDS) {
    await step(`fuel:${feed}`, async () => {
      const loaded = await loadFuelFeed(feed);
      const parts: string[] = [];
      for (const [code, { prices, ...summary }] of Object.entries(loaded)) {
        await store.saveSnapshot("fuel", code, summary);
        const saved = await store.saveFuelPrices(code, prices);
        parts.push(`${code} ${summary.stationCount} stations, ${saved} prices for ${summary.date}`);
      }
      const key = keyNeeded(loaded[Object.keys(loaded)[0] as keyof typeof loaded]!.code);
      return parts.join("; ") + (key ? ` (${key})` : "");
    });
  }

  await store.finishRun(runId, results);
  return results;
}
