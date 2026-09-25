// What the app needs from a database. The local SQLite store implements this
// today; a hosted store (Supabase/Postgres) only has to implement the same
// methods and be returned from lib/db/index.ts.
import type { Series, Point } from "../sources/types";
import type { Contract, Notice, Release } from "../sources/austender";
import type { FuelPrice } from "../sources/fuel/types";
import type { ApsRow } from "../sources/apsc";
import type { ExpenseRow } from "../sources/ipea";
import type { StateGrantRow } from "../sources/state-grants/types";
import type { GrantRow } from "../sources/grantconnect";

export type BackfillProgress = {
  unit: string; status: "pending" | "running" | "done" | "failed"; cursor: string | null;
  rowsAdded: number; calls: number; started: string | null; finished: string | null; error: string | null;
};

export type CompanyRow = { abn: string; name: string; incomeYear: string; income: number; taxable: number; tax: number };

// A contract as the API gives it, plus the notice page once it has been read.
export type ContractRow = Contract & { pageId: string | null; notice: Notice | null; noticeReadAt: string | null };

// A notice whose own fields disagree: flagged as an Australian business with an overseas address or no ABN.
export type Contradiction = {
  id: string; pageId: string | null; agency: string; supplier: string; value: number; description: string;
  published: string; supplierCountry: string | null; supplierAbn: string | null; australianBusiness: string | null;
};

// A period whose value changed after it was first stored: the publisher revised it.
export type Revision = {
  seriesId: string; label: string; unit: Series["unit"]; source: string; period: string;
  firstValue: number; firstSeen: string; latestValue: number; latestSeen: string;
};

export type DbStats = {
  location: string;
  series: number;
  observations: number;
  snapshots: number;
  companies: number;
  contracts: number;
  noticesRead: number;
  fuelPrices: number; // station prices held right now, one per station and fuel
  apsRows: number; // cells of the APS headcount tables, one row each
  apsReleases: number;
  expenses: number; // parliamentarians' expense lines from IPEA
  stateGrants: number; // state grant payment lines, every published column
  grants: number; // Commonwealth grant awards from GrantConnect, every report column
  contractReleases: number; // every AusTender release (original notices and amendments), every API field
  lastRun: { startedAt: string; finishedAt: string | null; ok: boolean; saved: number; failed: number } | null;
};

export type RunResult = { source: string; ok: boolean; detail: string };

export interface Store {
  // Time series. A changed value for a period is kept as a new row, so revisions by the publisher stay visible.
  saveSeries(series: Series): Promise<{ added: number; revised: number }>;
  seriesHistory(seriesId: string): Promise<(Point & { firstSeen: string; lastSeen: string })[]>;
  revisions(): Promise<Revision[]>; // every period with more than one value, first and latest
  // Stored contracts by id, for joining amendments back to the original notice.
  contractsById(ids: string[]): Promise<Pick<Contract, "id" | "agency" | "supplier" | "value" | "description" | "published">[]>;

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

  // Fuel: every station's current price for one state, every field the scheme gives, replacing yesterday's
  // rows for that state. Thousands of stations a day would outgrow the VM's disk if kept; the state-level
  // history lives in snapshots instead.
  saveFuelPrices(state: string, rows: FuelPrice[]): Promise<number>;
  // APS headcount: every cell of the APSC's agency-by-gender-by-classification table, per release.
  saveApsHeadcount(rows: ApsRow[]): Promise<{ added: number }>;
  // Every parliamentarian expense line IPEA publishes, one row each, every column as published.
  saveExpenses(rows: ExpenseRow[]): Promise<{ added: number }>;
  // Commonwealth grant awards, one row per GA id, every column of the GrantConnect report as JSON plus the fields worth querying.
  saveGrants(rows: GrantRow[]): Promise<{ added: number }>;
  // State grant payments, one row per line of the published list: the shared fields as columns and every
  // published column as JSON. `replace` says what the load is the whole of, so stored rows it no longer
  // carries are removed: the years it covers (a file republished whole), the programs it re-read (a register
  // walked program by program), or nothing (a list that rolls forward, whose rows accumulate).
  saveStateGrants(rows: StateGrantRow[], replace: { years: true } | { programs: string[] } | null): Promise<{ added: number; removed: number }>;
  // What is stored per program for a state (line count and total), to find the programs a source has changed.
  stateGrantPrograms(state: string): Promise<{ programId: string; count: number; total: number }[]>;
  // Every stored line for a state, for building the page summary from the database.
  stateGrantRows(state: string): Promise<StateGrantRow[]>;
  // One row per contract per release from the AusTender API, every field, keyed by release id and CN id.
  saveReleases(rows: Release[]): Promise<{ added: number }>;
  // Backfill bookkeeping: one row per unit (e.g. contracts:FY2025-26), with the cursor a walked unit reached.
  backfillProgress(unit: string): Promise<BackfillProgress | null>;
  saveBackfillProgress(p: BackfillProgress): Promise<void>;

  startRun(): Promise<number>;
  finishRun(id: number, results: RunResult[]): Promise<void>;
  stats(): Promise<DbStats>;
}
