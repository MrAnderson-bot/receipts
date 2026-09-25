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

async function load(): Promise<Budget> {
  const headers = { "User-Agent": USER_AGENT };
  // Finance creates one dataset per Budget; the newest one whose title starts with "Budget" is current.
  const search = await fetch(
    `${CKAN}/package_search?q=${encodeURIComponent('title:"Portfolio Budget Statements" tables and data')}&rows=10&sort=metadata_created+desc`,
    { headers, cache: "no-store" });
  if (!search.ok) throw new Error(`data.gov.au returned ${search.status}`);
  const datasets: any[] = (await search.json()).result?.results ?? [];
  const dataset = datasets.find((d) => /^Budget \d{4}/i.test(d.title) &&
    d.resources.some((r: any) => /Budget Paper No\.? ?1 Tables/i.test(r.name ?? "")));
  if (!dataset) throw new Error("No current Budget tables dataset found on data.gov.au");
  const resource = (pattern: RegExp) => dataset.resources.find((r: any) => pattern.test(r.name ?? ""))?.url as string | undefined;
  const budgetYear = dataset.title.match(/(\d{4})-(\d{2,4})/)?.slice(1).map((p: string, i: number) => (i ? p.slice(-2) : p)).join("-") ?? "";

  // Budget Paper 1 tables: a zip of CSVs. Table numbers move between Budgets, so match on each table's title line.
  const zipRes = await fetch(resource(/Budget Paper No\.? ?1 Tables/i)!, { headers, cache: "no-store" });
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
  // Columns: year, revenue $m, % GDP, expenses $m, % GDP, net operating balance $m, % GDP, net capital investment $m, % GDP, fiscal balance $m, % GDP
  const accrual = table(/net capital investment and fiscal balance/i);
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

// New tables arrive with each Budget, so a daily check is plenty.
const cached = unstable_cache(load, ["budget-tables"], { revalidate: 86_400 });

export async function tryGetBudget(): Promise<{ data: Budget | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
