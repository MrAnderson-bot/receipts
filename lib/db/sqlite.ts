// Local SQLite store at data/receipts.db, using the SQLite that ships with
// Node 22.5 and later, so there is nothing to install or compile.
import { mkdirSync } from "fs";
import path from "path";
import type { Series } from "../sources/types";
import type { CompanyRow, DbStats, RunResult, Store } from "./types";

const FILE = path.join(process.cwd(), "data", "receipts.db");

// The slice of node:sqlite this file uses. Typed here because the project's @types/node predates the module.
type Statement = { run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }; get(...p: unknown[]): any; all(...p: unknown[]): any[] };
type Database = { exec(sql: string): void; prepare(sql: string): Statement };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, unit TEXT NOT NULL, frequency TEXT NOT NULL,
  source TEXT NOT NULL, source_url TEXT NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  series_id TEXT NOT NULL REFERENCES series(id), period TEXT NOT NULL, value REAL NOT NULL,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (series_id, period, value)
);
CREATE INDEX IF NOT EXISTS observations_by_period ON observations (series_id, period, last_seen);
CREATE TABLE IF NOT EXISTS snapshots (
  source TEXT NOT NULL, key TEXT NOT NULL, captured_on TEXT NOT NULL, captured_at TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (source, key, captured_on)
);
CREATE TABLE IF NOT EXISTS companies (
  abn TEXT NOT NULL, name TEXT NOT NULL, income_year TEXT NOT NULL,
  income REAL NOT NULL, taxable REAL NOT NULL, tax REAL NOT NULL,
  PRIMARY KEY (abn, name, income_year)
);
CREATE INDEX IF NOT EXISTS companies_by_abn ON companies (abn);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, detail TEXT
);`;

let db: Database | null = null;
function open(): Database {
  if (db) return db;
  // Loaded this way so the bundler doesn't try to resolve a module it doesn't know about.
  const sqlite = (process as any).getBuiltinModule?.("node:sqlite");
  if (!sqlite) throw new Error("This Node version has no built-in SQLite. Use Node 22.5 or later.");
  mkdirSync(path.dirname(FILE), { recursive: true });
  const opened: Database = new sqlite.DatabaseSync(FILE);
  opened.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  opened.exec(SCHEMA);
  db = opened;
  return opened;
}

const now = () => new Date().toISOString();

export const sqliteStore: Store = {
  async saveSeries(s: Series) {
    const d = open();
    const at = now();
    d.prepare(`INSERT INTO series (id, label, unit, frequency, source, source_url, note, updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, unit=excluded.unit, frequency=excluded.frequency,
        source=excluded.source, source_url=excluded.source_url, note=excluded.note, updated_at=excluded.updated_at`)
      .run(s.id, s.label, s.unit, s.frequency, s.source, s.sourceUrl, s.note, at);

    const known = d.prepare("SELECT 1 FROM observations WHERE series_id = ? AND period = ? LIMIT 1");
    const same = d.prepare("SELECT 1 FROM observations WHERE series_id = ? AND period = ? AND value = ? LIMIT 1");
    const upsert = d.prepare(`INSERT INTO observations (series_id, period, value, first_seen, last_seen) VALUES (?,?,?,?,?)
      ON CONFLICT(series_id, period, value) DO UPDATE SET last_seen = excluded.last_seen`);
    let added = 0, revised = 0;
    d.exec("BEGIN");
    try {
      for (const p of s.points) {
        // A period seen before with a different value is a revision by the publisher; keep both rows.
        if (!same.get(s.id, p.period, p.value)) known.get(s.id, p.period) ? revised++ : added++;
        upsert.run(s.id, p.period, p.value, at, at);
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added, revised };
  },

  async seriesHistory(seriesId) {
    // For each period, the value most recently seen is the current one; earlier rows are superseded revisions.
    return open().prepare(`SELECT period, value, first_seen AS firstSeen, last_seen AS lastSeen FROM observations
      WHERE series_id = ? ORDER BY period, last_seen`).all(seriesId);
  },

  async saveSnapshot(source, key, payload) {
    const at = now();
    open().prepare(`INSERT INTO snapshots (source, key, captured_on, captured_at, payload) VALUES (?,?,?,?,?)
      ON CONFLICT(source, key, captured_on) DO UPDATE SET captured_at = excluded.captured_at, payload = excluded.payload`)
      .run(source, key, at.slice(0, 10), at, JSON.stringify(payload));
  },

  async snapshots(source, key, limit = 30) {
    return open().prepare("SELECT captured_on AS capturedOn, payload FROM snapshots WHERE source = ? AND key = ? ORDER BY captured_on DESC LIMIT ?")
      .all(source, key, limit).map((r) => ({ capturedOn: r.capturedOn as string, payload: JSON.parse(r.payload) }));
  },

  async saveCompanies(rows: CompanyRow[]) {
    const d = open();
    const insert = d.prepare(`INSERT INTO companies (abn, name, income_year, income, taxable, tax) VALUES (?,?,?,?,?,?)
      ON CONFLICT(abn, name, income_year) DO UPDATE SET income = excluded.income, taxable = excluded.taxable, tax = excluded.tax`);
    d.exec("BEGIN");
    try {
      for (const r of rows) insert.run(r.abn, r.name, r.incomeYear, r.income, r.taxable, r.tax);
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return rows.length;
  },

  async startRun() {
    return Number(open().prepare("INSERT INTO runs (started_at) VALUES (?)").run(now()).lastInsertRowid);
  },

  async finishRun(id, results: RunResult[]) {
    const failed = results.filter((r) => !r.ok).length;
    open().prepare("UPDATE runs SET finished_at = ?, ok = ?, saved = ?, failed = ?, detail = ? WHERE id = ?")
      .run(now(), failed === 0 ? 1 : 0, results.length - failed, failed, JSON.stringify(results), id);
  },

  async stats(): Promise<DbStats> {
    const d = open();
    const count = (table: string) => Number(d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    const run = d.prepare("SELECT started_at, finished_at, ok, saved, failed FROM runs ORDER BY id DESC LIMIT 1").get();
    return {
      location: path.relative(process.cwd(), FILE).replace(/\\/g, "/"),
      series: count("series"), observations: count("observations"), snapshots: count("snapshots"), companies: count("companies"),
      lastRun: run ? { startedAt: run.started_at, finishedAt: run.finished_at, ok: !!run.ok, saved: run.saved, failed: run.failed } : null,
    };
  },
};
