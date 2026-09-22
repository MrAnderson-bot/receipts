// Reads every feed once and stores the result. Run daily. Each source is saved
// on its own, so one that is down doesn't stop the rest.
import { getStore, type RunResult } from "./index";
import { getIndicators } from "../economy";
import { tryGetSummary, RANGES } from "../sources/austender";
import { tryGetGrants } from "../sources/grantconnect";
import { tryGetRevenue } from "../sources/treasury";
import { tryGetTaxByLevel } from "../sources/abs-tax";
import { tryGetBudget } from "../sources/budget";
import { tryGetTransparency, loadAllEntities } from "../sources/ato-transparency";
import { tryGetProfits } from "../sources/abs-profits";
import { tryGetState, STATE_CODES } from "../sources/states";
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
    // Estimates change with every Budget, so they are kept whole in the snapshot, dated by when they were read.
    await store.saveSnapshot("budget", d.budgetYear, d);
    return `6 series, ${d.budgetYear} Budget`;
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
      // The full contract list is large and already public; keep the summary without it.
      const { contracts, ...summary } = need(await tryGetSummary(days));
      await store.saveSnapshot("contracts", `${days}d`, { ...summary, contractCount: contracts.length });
      return `${contracts.length} contracts`;
    });
    await step(`grants:${days}d`, async () => {
      const d = need(await tryGetGrants(days));
      await store.saveSnapshot("grants", `${days}d`, d);
      return `${d.count} grants`;
    });
  }

  for (const code of STATE_CODES) {
    await step(`state:${code}`, async () => {
      const d = need(await tryGetState(code));
      await store.saveSnapshot("state", code, d);
      return `${d.count} ${d.noun}`;
    });
  }

  await store.finishRun(runId, results);
  return results;
}
