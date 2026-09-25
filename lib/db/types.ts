// What the app needs from a database. The local SQLite store implements this
// today; a hosted store (Supabase/Postgres) only has to implement the same
// methods and be returned from lib/db/index.ts.
import type { Series, Point } from "../sources/types";
import type { Contract, Notice } from "../sources/austender";
import type { ExpenseRow } from "../sources/ipea";

export type CompanyRow = { abn: string; name: string; incomeYear: string; income: number; taxable: number; tax: number };

// A contract as the API gives it, plus the notice page once it has been read.
export type ContractRow = Contract & { pageId: string | null; notice: Notice | null; noticeReadAt: string | null };

// A notice whose own fields disagree: flagged as an Australian business with an overseas address or no ABN.
export type Contradiction = {
  id: string; pageId: string | null; agency: string; supplier: string; value: number; description: string;
  published: string; supplierCountry: string | null; supplierAbn: string | null; australianBusiness: string | null;
};

export type DbStats = {
  location: string;
  series: number;
  observations: number;
  snapshots: number;
  companies: number;
  contracts: number;
  noticesRead: number;
  expenses: number; // parliamentarians' expense lines from IPEA
  lastRun: { startedAt: string; finishedAt: string | null; ok: boolean; saved: number; failed: number } | null;
};

export type RunResult = { source: string; ok: boolean; detail: string };

export interface Store {
  // Time series. A changed value for a period is kept as a new row, so revisions by the publisher stay visible.
  saveSeries(series: Series): Promise<{ added: number; revised: number }>;
  seriesHistory(seriesId: string): Promise<(Point & { firstSeen: string; lastSeen: string })[]>;

  // Page-level summaries (contracts, grants, states, budget ...), one per source, key and day.
  saveSnapshot(source: string, key: string, payload: unknown): Promise<void>;
  snapshots(source: string, key: string, limit?: number): Promise<{ capturedOn: string; payload: unknown }[]>;

  // The Tax Office's full company list, kept whole so it can be joined to suppliers and grant recipients by ABN.
  saveCompanies(rows: CompanyRow[]): Promise<number>;

  // Every contract notice, one row each, matching what tenders.gov.au shows once the notice has been read.
  saveContracts(rows: Contract[]): Promise<{ added: number }>;
  contractsWithoutNotice(limit: number): Promise<{ id: string; pageId: string }[]>;
  saveNotice(id: string, notice: Notice): Promise<void>;
  contradictions(limit: number): Promise<Contradiction[]>;

  // Every parliamentarian expense line IPEA publishes, one row each, every column as published.
  saveExpenses(rows: ExpenseRow[]): Promise<{ added: number }>;

  startRun(): Promise<number>;
  finishRun(id: number, results: RunResult[]): Promise<void>;
  stats(): Promise<DbStats>;
}
