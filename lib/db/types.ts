// What the app needs from a database. The local SQLite store implements this
// today; a hosted store (Supabase/Postgres) only has to implement the same
// methods and be returned from lib/db/index.ts.
import type { Series, Point } from "../sources/types";

export type CompanyRow = { abn: string; name: string; incomeYear: string; income: number; taxable: number; tax: number };

export type DbStats = {
  location: string;
  series: number;
  observations: number;
  snapshots: number;
  companies: number;
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

  startRun(): Promise<number>;
  finishRun(id: number, results: RunResult[]): Promise<void>;
  stats(): Promise<DbStats>;
}
