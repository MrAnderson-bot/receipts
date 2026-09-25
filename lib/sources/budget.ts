// The Commonwealth Budget's own tables, which the Department of Finance posts on
// data.gov.au with every Budget (CC BY 4.0): a zip of Budget Paper No. 1 tables
// and a spreadsheet of every program's expenses. Figures for past years in the
// historical tables are final outcomes; years marked (e) are estimates.
import { unstable_cache } from "next/cache";
import { parseCsv, parseMoney } from "../csv";
import { readWorkbook, unzip, USER_AGENT } from "../xlsx";
import type { YearValue } from "./treasury";

const CKAN = "https://data.gov.au/data/api/3/action";

export type BudgetProgram = { portfolio: string; agency: string; program: string; value: number }; // $

export type Budget = {
  edition: string; // "Budget 2026-2027 and Portfolio Budget Statements (PBS) - Tables and Data"
  datasetUrl: string;
  budgetYear: string; // 2026-27
  latestActual: string; // last year with a final outcome
  functions: { name: string; series: YearValue[] }[]; // expenses by function, $m, largest first in the budget year
  totalExpenses: YearValue[]; // $m
  receipts: YearValue[]; // $m, back to 1970-71
  payments: YearValue[]; // $m
  balance: YearValue[]; // underlying cash balance, $m
  balanceShare: YearValue[]; // underlying cash balance, % of GDP
  netDebt: YearValue[]; // $m
  netDebtShare: YearValue[]; // % of GDP
  netInterest: YearValue[]; // net interest payments, $m
  // Added for the government scorecard.
  receiptsShare: YearValue[]; // receipts, % of GDP
  paymentsRealGrowth: YearValue[]; // payments, real growth on the previous year, %
  netInterestShare: YearValue[]; // net interest payments, % of GDP
  netCapitalInvestment: YearValue[]; // general government net capital investment, $m
  netCapitalInvestmentShare: YearValue[]; // % of GDP
  programs: BudgetProgram[]; // 20 largest programs in the budget year
  portfolios: { name: string; value: number }[]; // program expenses by portfolio, budget year
};

// "2025-26 (e)" -> { year, estimate }
const parseYear = (label: string) => {
  const year = label.match(/\d{4}-\d{2}/)?.[0];
  return year ? { year, estimate: /\((e|est)\)/i.test(label) } : null;
};

// Historical tables have one row per year; `col` picks the measure.
function byYear(rows: string[][], col: number): YearValue[] {
  return rows.flatMap((r) => {
    const y = parseYear(r[0] ?? "");
    const v = parseMoney(r[col]);
    return y && /^\d{4}-\d{2}/.test(r[0]) && v !== null ? [{ ...y, value: v }] : [];
  });
}

// Finance creates one dataset per Budget on data.gov.au, back to 2014-15. Titles read "Budget 2026-2027 and
// Portfolio Budget Statements (PBS) - Tables and Data" (older ones "Budget 2023-24", one "Budget 2014 -15").
export async function listBudgetDatasets(): Promise<{ year: string; title: string; name: string; resources: any[] }[]> {
  const search = await fetch(
    `${CKAN}/package_search?q=${encodeURIComponent('title:"Portfolio Budget Statements" tables and data')}&rows=40&sort=metadata_created+desc`,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!search.ok) throw new Error(`data.gov.au returned ${search.status}`);
  const datasets: any[] = (await search.json()).result?.results ?? [];
  const out = datasets.flatMap((d) => {
    const m = String(d.title ?? "").match(/^Budget\s+(\d{4})\s*-\s*(\d{2,4})/i);
    if (!m || !d.resources?.length) return [];
    return [{ year: `${m[1]}-${m[2].slice(-2)}`, title: d.title as string, name: d.name as string, resources: d.resources as any[] }];
  });
  // The same Budget can be listed twice; keep the first (newest) copy of each year, newest year first.
  return [...new Map(out.map((d) => [d.year, d])).values()].sort((a, b) => b.year.localeCompare(a.year));
}

// The current Budget by default, or the Budget for `year` (e.g. "2019-20") for the backfill.
export async function loadBudget(year?: string): Promise<Budget> {
  const headers = { "User-Agent": USER_AGENT };
  const datasets = await listBudgetDatasets();
  const dataset = year ? datasets.find((d) => d.year === year) : datasets[0];
  if (!dataset) throw new Error(year ? `No Budget ${year} tables dataset found on data.gov.au` : "No current Budget tables dataset found on data.gov.au");
  const resource = (pattern: RegExp) => dataset.resources.find((r: any) => pattern.test(r.name ?? ""))?.url as string | undefined;
  const budgetYear = dataset.year;
  if (!resource(/Budget Paper No\.? ?1\b/i)) throw new Error(`Budget ${budgetYear} has no Budget Paper No. 1 tables zip on data.gov.au`);

  // Budget Paper 1 tables: a zip of CSVs, named "Budget Paper No.1 Tables" or "... Budget Strategy and Outlook Tables"
  // depending on the year (2014-15 and 2015-16 published loose CSVs instead, which this cannot read). Table numbers
  // move between Budgets, so match on each table's title line.
  const zipRes = await fetch(resource(/Budget Paper No\.? ?1\b/i)!, { headers, cache: "no-store" });
  if (!zipRes.ok) throw new Error(`data.gov.au returned ${zipRes.status} for the Budget Paper 1 tables`);
  const tables = [...unzip(Buffer.from(await zipRes.arrayBuffer())).entries()]
    .filter(([name]) => /\.csv$/i.test(name))
    .map(([, read]) => parseCsv(read().toString("utf8")));
  const table = (title: RegExp) => {
    const t = tables.find((rows) => title.test(rows[0]?.[0] ?? ""));
    if (!t) throw new Error(`Budget Paper 1 tables no longer include "${title.source}"; the layout may have changed`);
    return t;
  };

  const fn = table(/expenses by function/i);
  const yearRow = fn.find((r) => r.filter((c) => /^\d{4}-\d{2}/.test(c)).length >= 3)!;
  const fnSeries = (r: string[]): YearValue[] => yearRow.flatMap((label, i) => {
    const y = parseYear(label);
    const v = parseMoney(r[i]);
    // Every year in this table is an estimate: it is the Budget's forward plan.
    return y && v !== null ? [{ year: y.year, estimate: true, value: v }] : [];
  });
  const fnRows = fn.filter((r) => r[0] && parseMoney(r[1]) !== null && !/^\d{4}-\d{2}/.test(r[0]));
  const at = (s: YearValue[]) => s.find((p) => p.year === budgetYear)?.value ?? 0;
  const functions = fnRows.filter((r) => !/^total/i.test(r[0]))
    .map((r) => ({ name: r[0], series: fnSeries(r) }))
    .sort((a, b) => at(b.series) - at(a.series));
  const totalExpenses = fnSeries(fnRows.find((r) => /^total expenses/i.test(r[0])) ?? []);

  // Columns: year, receipts $m, % GDP, payments $m, real growth, % GDP, Future Fund, balance $m, % GDP
  const cash = table(/receipts, payments.*underlying cash balance/i);
  // Columns: year, net debt $m, % GDP, net interest $m, % GDP
  const debt = table(/net debt and net interest payments/i);
  // Columns: year, revenue $m, % GDP, expenses $m, % GDP, net operating balance $m, % GDP, net capital investment $m, % GDP, fiscal balance $m, % GDP.
  // Older Budgets' zips may not carry this table; then those columns are simply empty.
  let accrual: string[][] = [];
  try { accrual = table(/net capital investment and fiscal balance/i); } catch { accrual = []; }
  const receipts = byYear(cash, 1);

  // Program expenses, in $'000. "Revenue from Government" rows repeat money already counted as an expense.
  const programs = new Map<string, BudgetProgram>();
  const portfolios = new Map<string, number>();
  const pbsUrl = resource(/Program Expense/i);
  if (pbsUrl) {
    const pbsRes = await fetch(pbsUrl, { headers, cache: "no-store" });
    if (pbsRes.ok) {
      const book = readWorkbook(Buffer.from(await pbsRes.arrayBuffer()));
      const rows = book.sheet(book.sheetNames[0]);
      const head = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([col, name]) => [name.trim(), col]));
      const yearCol = head[budgetYear];
      for (const r of rows.slice(1)) {
        if (!yearCol || !/expenses/i.test(r[head["Expense_type"]] ?? "")) continue;
        const value = (Number(r[yearCol]) || 0) * 1000;
        const portfolio = r[head["Portfolio"]] ?? "Unknown", agency = r[head["Agency Name"]] ?? "", program = r[head["Program"]] ?? "";
        const key = `${agency}|${program}`;
        const p = programs.get(key) ?? { portfolio, agency, program, value: 0 };
        p.value += value; programs.set(key, p);
        portfolios.set(portfolio, (portfolios.get(portfolio) ?? 0) + value);
      }
    }
  }

  return {
    edition: dataset.title,
    datasetUrl: `https://data.gov.au/data/dataset/${dataset.name}`,
    budgetYear,
    latestActual: [...receipts].reverse().find((r) => !r.estimate)?.year ?? "",
    functions, totalExpenses, receipts,
    payments: byYear(cash, 3), balance: byYear(cash, 7), balanceShare: byYear(cash, 8),
    netDebt: byYear(debt, 1), netDebtShare: byYear(debt, 2), netInterest: byYear(debt, 3),
    receiptsShare: byYear(cash, 2), paymentsRealGrowth: byYear(cash, 4), netInterestShare: byYear(debt, 4),
    netCapitalInvestment: byYear(accrual, 7), netCapitalInvestmentShare: byYear(accrual, 8),
    programs: [...programs.values()].sort((a, b) => b.value - a.value).slice(0, 20),
    portfolios: [...portfolios.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
}

// Every program expense line in a Budget's Portfolio Budget Statements, as Finance publishes them with each
// Budget since 2014-15 ("PBS Program Expense Line Items", CSV or xlsx; "PBS Line Items Dataset" in the first
// two years). One row per program, expense type and description, with a column per year the Budget covered,
// in $'000. This is what past Budgets reliably offer (their zips carry no expenses-by-function table), so it
// is what the backfill stores for each Budget (docs/backfill.md).
export type ProgramLine = {
  portfolio: string; agency: string; outcome: string; program: string; expenseType: string; appropriation: string; description: string;
  values: Record<string, number>; // financial year -> dollars
};
export type BudgetPrograms = {
  budgetYear: string; datasetUrl: string; fileUrl: string;
  years: string[]; // the year columns, oldest first
  lines: ProgramLine[];
  byPortfolio: { name: string; values: Record<string, number> }[]; // expense lines only, largest in the budget year first
};

export async function loadBudgetPrograms(year: string): Promise<BudgetPrograms> {
  const headers = { "User-Agent": USER_AGENT };
  const dataset = (await listBudgetDatasets()).find((d) => d.year === year);
  if (!dataset) throw new Error(`No Budget ${year} dataset found on data.gov.au`);
  const file = dataset.resources.find((r: any) => /Program Expenses? Line Items|PBS Line Items Dataset/i.test(r.name ?? ""));
  if (!file) throw new Error(`Budget ${year} has no program expense line items file`);
  const res = await fetch(file.url as string, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.gov.au returned ${res.status} for the ${year} program expense file`);
  const buf = Buffer.from(await res.arrayBuffer());
  // CSV most years, xlsx in 2026-27; either way a grid of cells with the header somewhere near the top.
  let grid: string[][];
  if (/\.xlsx$/i.test(String(file.url)) || buf.subarray(0, 2).toString() === "PK") {
    const book = readWorkbook(buf);
    const rows = book.sheet(book.sheetNames[0]);
    const letters = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort((a, b) => a.length - b.length || a.localeCompare(b));
    grid = rows.map((r) => letters.map((l) => String(r[l] ?? "")));
  } else {
    grid = parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  }
  const headAt = grid.findIndex((r) => r.some((c) => /^portfolio$/i.test(c.trim())) && r.some((c) => /^program$/i.test(c.trim())));
  if (headAt < 0) throw new Error(`The ${year} program expense file has no Portfolio/Program header row; the layout may have changed`);
  const head = grid[headAt].map((c) => c.trim());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const col = {
    portfolio: find(/^portfolio$/i), agency: find(/^(department\/agency|agency name|agency|entity)$/i), outcome: find(/^outcome$/i),
    program: find(/^program$/i), expenseType: find(/^expense[ _]?type$/i), appropriation: find(/^appropriation[ _]?type$/i), description: find(/^description$/i),
  };
  const yearCols = head.map((h, i) => [h.match(/^(\d{4}-\d{2})/)?.[1] ?? "", i] as const).filter(([y]) => y);
  const years = yearCols.map(([y]) => y);
  if (col.program < 0 || years.length === 0) throw new Error(`The ${year} program expense file has no program or year columns`);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const lines: ProgramLine[] = grid.slice(headAt + 1).filter((r) => cell(r, col.program)).map((r) => ({
    portfolio: cell(r, col.portfolio) || "Unknown", agency: cell(r, col.agency), outcome: cell(r, col.outcome), program: cell(r, col.program),
    expenseType: cell(r, col.expenseType), appropriation: cell(r, col.appropriation), description: cell(r, col.description),
    values: Object.fromEntries(yearCols.map(([y, i]) => [y, (Number(cell(r, i).replace(/,/g, "")) || 0) * 1000])),
  }));
  // Expense lines only: "Program Component" and "Revenue from Government" rows repeat money already counted.
  const portfolios = new Map<string, Record<string, number>>();
  for (const l of lines) {
    if (!/expenses/i.test(l.expenseType)) continue;
    const v = portfolios.get(l.portfolio) ?? Object.fromEntries(years.map((y) => [y, 0]));
    for (const y of years) v[y] += l.values[y] ?? 0;
    portfolios.set(l.portfolio, v);
  }
  return {
    budgetYear: year, datasetUrl: `https://data.gov.au/data/dataset/${dataset.name}`, fileUrl: file.url, years, lines,
    byPortfolio: [...portfolios.entries()].map(([name, values]) => ({ name, values })).sort((a, b) => (b.values[year] ?? 0) - (a.values[year] ?? 0)),
  };
}

// New tables arrive with each Budget, so a daily check is plenty.
const cached = unstable_cache(() => loadBudget(), ["budget-tables"], { revalidate: 86_400 });

export async function tryGetBudget(): Promise<{ data: Budget | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
