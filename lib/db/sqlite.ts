// Local SQLite store at data/receipts.db, using the SQLite that ships with
// Node 22.5 and later, so there is nothing to install or compile.
import { mkdirSync } from "fs";
import path from "path";
import type { Series } from "../sources/types";
import { noticePageId, type Contract, type Notice, type Release } from "../sources/austender";
import type { FuelPrice } from "../sources/fuel/types";
import type { ApsRow } from "../sources/apsc";
import type { BackfillProgress, CompanyRow, Contradiction, DbStats, Revision, RunResult, Store } from "./types";
import { EXPENSE_COLUMNS, type ExpenseRow } from "../sources/ipea";
import type { GrantRow } from "../sources/grantconnect";
import type { StateGrantRow } from "../sources/state-grants/types";

// UniqueId -> unique_id, ReportingPeriodId -> reporting_period_id, and so on.
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const EXPENSE_DB_COLUMNS = EXPENSE_COLUMNS.map(snake);

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
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, award_id TEXT, page_id TEXT,
  agency TEXT NOT NULL, supplier TEXT NOT NULL, supplier_abn TEXT, supplier_country TEXT,
  value REAL NOT NULL, description TEXT NOT NULL, method TEXT NOT NULL, limited_reason TEXT,
  category_code TEXT NOT NULL, category_name TEXT NOT NULL, unspsc TEXT,
  start TEXT, end TEXT, published TEXT NOT NULL, late_days INTEGER,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  -- the notice page, filled in once read
  notice_read_at TEXT, notice TEXT,
  n_execution_date TEXT, n_extension_options INTEGER, n_max_end_date TEXT, n_atm_id TEXT,
  n_australian_business TEXT, n_sme_engaged TEXT, n_nz_business TEXT, n_suppliers_invited INTEGER,
  n_confidential_contract TEXT, n_confidential_outputs TEXT, n_consultancy TEXT, n_limited_exemption TEXT,
  n_supplier_country TEXT, n_supplier_abn TEXT
);
CREATE INDEX IF NOT EXISTS contracts_unread ON contracts (notice_read_at, published);
CREATE INDEX IF NOT EXISTS contracts_by_flag ON contracts (n_australian_business, value);
CREATE TABLE IF NOT EXISTS fuel_prices (
  state TEXT NOT NULL, site_id TEXT NOT NULL, fuel TEXT NOT NULL, fuel_raw TEXT NOT NULL,
  name TEXT NOT NULL, brand TEXT NOT NULL, address TEXT NOT NULL, suburb TEXT NOT NULL, postcode TEXT,
  lat REAL, lng REAL, price REAL NOT NULL, reported_at TEXT NOT NULL, captured_at TEXT NOT NULL,
  PRIMARY KEY (state, site_id, fuel_raw)
);
CREATE TABLE IF NOT EXISTS aps_headcount (
  release TEXT NOT NULL, agency TEXT NOT NULL, parent TEXT, gender TEXT NOT NULL, classification TEXT NOT NULL,
  headcount INTEGER, source_url TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (release, agency, gender, classification)
);
-- Parliamentarians' expense lines from IPEA, one row each, every published column as text (amount included),
-- plus amount_aud as a number for sums.
CREATE TABLE IF NOT EXISTS ipea_expenses (
  ${EXPENSE_DB_COLUMNS.map((c) => `${c} TEXT${c === "unique_id" ? " PRIMARY KEY" : ""}`).join(", ")},
  amount_aud REAL NOT NULL, source_url TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ipea_expenses_by_period ON ipea_expenses (reporting_period_id, surname, first_name);
-- State grant payment lines, one row per line of the state's published list. The reduced fields every state
-- shares are columns; "fields" holds every column the state published, as JSON under the published headings,
-- so nothing is lost when a state's layout differs. "id" is the line's position where a whole file is
-- republished (Queensland) or the grant's own facts where a list rolls forward (Lotterywest).
CREATE TABLE IF NOT EXISTS state_grants (
  state TEXT NOT NULL, financial_year TEXT NOT NULL, id TEXT NOT NULL, program_id TEXT NOT NULL,
  agency TEXT NOT NULL, agency_code TEXT NOT NULL, program TEXT NOT NULL, sub_program TEXT NOT NULL, purpose TEXT NOT NULL,
  recipient TEXT NOT NULL, recipient_abn TEXT, pooled INTEGER NOT NULL, recipient_type TEXT NOT NULL, category TEXT NOT NULL,
  assistance TEXT NOT NULL, funding_source TEXT NOT NULL, value REAL NOT NULL, agreement_total REAL,
  start TEXT, end TEXT, delivery_lga TEXT NOT NULL, fields TEXT NOT NULL,
  source_url TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (state, financial_year, id)
);
CREATE INDEX IF NOT EXISTS state_grants_by_abn ON state_grants (recipient_abn);
CREATE INDEX IF NOT EXISTS state_grants_by_program ON state_grants (state, program_id);
-- Every release the AusTender API publishes, one row per contract per release: the original notice (tag
-- "contract") and each amendment (tag "contractAmendment", same cn_id, its own award and page). Every API
-- field has a column and the whole release is kept as JSON, minus agency contact names, emails and phones.
CREATE TABLE IF NOT EXISTS contract_releases (
  release_id TEXT NOT NULL, cn_id TEXT NOT NULL, ocid TEXT NOT NULL, release_date TEXT NOT NULL, tag TEXT NOT NULL,
  initiation_type TEXT, language TEXT,
  award_id TEXT, page_id TEXT, award_date TEXT, award_status TEXT,
  agency_party_id TEXT, agency TEXT NOT NULL, agency_abn TEXT, agency_branch TEXT, agency_division TEXT,
  supplier_party_id TEXT, supplier TEXT NOT NULL, supplier_abn TEXT,
  supplier_street TEXT, supplier_locality TEXT, supplier_region TEXT, supplier_postcode TEXT, supplier_country TEXT,
  title TEXT, description TEXT NOT NULL, contract_status TEXT, date_signed TEXT,
  value REAL NOT NULL, currency TEXT, period_start TEXT, period_end TEXT,
  unspsc TEXT, unspsc_scheme TEXT, items TEXT NOT NULL,
  tender_id TEXT, procurement_method TEXT, procurement_method_details TEXT,
  limited_tender_exempt TEXT, exemption_code TEXT, exemption TEXT, limited_reason_code TEXT, limited_reason TEXT,
  release TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (release_id, cn_id)
);
CREATE INDEX IF NOT EXISTS contract_releases_by_cn ON contract_releases (cn_id, release_date);
CREATE INDEX IF NOT EXISTS contract_releases_by_date ON contract_releases (release_date);
CREATE INDEX IF NOT EXISTS contract_releases_by_agency ON contract_releases (agency_abn, release_date);
CREATE INDEX IF NOT EXISTS contract_releases_by_supplier ON contract_releases (supplier_abn, release_date);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY, agency TEXT NOT NULL, recipient TEXT NOT NULL, recipient_abn TEXT, program TEXT, category TEXT,
  selection TEXT, value REAL NOT NULL, published TEXT, start TEXT, end TEXT, delivery_state TEXT,
  fields TEXT NOT NULL, source_url TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_by_published ON grants (published);
CREATE INDEX IF NOT EXISTS grants_by_recipient_abn ON grants (recipient_abn);
CREATE INDEX IF NOT EXISTS grants_by_agency ON grants (agency, published);
CREATE TABLE IF NOT EXISTS backfill_progress (
  unit TEXT PRIMARY KEY, status TEXT NOT NULL, cursor TEXT, rows_added INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0, started TEXT, finished TEXT, error TEXT
);
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
  // busy_timeout: the dev server, the nightly build and a backfill script may share the file; wait, don't fail.
  opened.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  // state_grants changed shape twice on 25 September 2026 before it was ever filled outside a scratch copy.
  // An empty table missing any column of the current schema is replaced by the current one.
  const grantCols = new Set((opened.prepare("PRAGMA table_info(state_grants)").all() as { name: string }[]).map((c) => c.name));
  const wantedGrantCols = [...(SCHEMA.match(/CREATE TABLE IF NOT EXISTS state_grants \(([\s\S]*?)\n\);/)?.[1] ?? "").matchAll(/(?:^|,)\s*(?:--[^\n]*\n\s*)?(\w+)\s+(?:TEXT|REAL|INTEGER)/g)].map((m) => m[1]);
  if (grantCols.size > 0 && wantedGrantCols.some((c) => !grantCols.has(c))
      && Number(opened.prepare("SELECT COUNT(*) AS n FROM state_grants").get().n) === 0) {
    opened.exec("DROP TABLE state_grants");
  }
  opened.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS leaves an existing table alone, so add any column the schema has gained since.
  const wanted = SCHEMA.match(/CREATE TABLE IF NOT EXISTS contracts \(([\s\S]*?)\n\);/)?.[1] ?? "";
  const have = new Set(opened.prepare("PRAGMA table_info(contracts)").all().map((c: any) => c.name));
  for (const m of wanted.matchAll(/(?:^|,)\s*(?:--[^\n]*\n\s*)?(\w+)\s+(TEXT|REAL|INTEGER)/g)) {
    if (!have.has(m[1])) opened.exec(`ALTER TABLE contracts ADD COLUMN ${m[1]} ${m[2]}`);
  }
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

  async revisions(): Promise<Revision[]> {
    // The row seen first is what the publisher said originally; the row seen last is what they say now.
    return open().prepare(`SELECT o.series_id AS seriesId, s.label, s.unit, s.source, o.period,
        f.value AS firstValue, f.first_seen AS firstSeen, l.value AS latestValue, l.last_seen AS latestSeen
      FROM (SELECT series_id, period FROM observations GROUP BY series_id, period HAVING COUNT(*) > 1) o
      JOIN series s ON s.id = o.series_id
      JOIN observations f ON f.series_id = o.series_id AND f.period = o.period
        AND f.first_seen = (SELECT MIN(first_seen) FROM observations WHERE series_id = o.series_id AND period = o.period)
      JOIN observations l ON l.series_id = o.series_id AND l.period = o.period
        AND l.last_seen = (SELECT MAX(last_seen) FROM observations WHERE series_id = o.series_id AND period = o.period)
      WHERE f.value <> l.value
      ORDER BY s.source, s.label, o.period`).all();
  },

  async contractsById(ids) {
    if (ids.length === 0) return [];
    const marks = ids.map(() => "?").join(",");
    return open().prepare(`SELECT id, agency, supplier, value, description, published FROM contracts WHERE id IN (${marks})`).all(...ids);
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

  async saveGrants(rows: GrantRow[]) {
    const d = open();
    const at = now();
    const cols = ["id", "agency", "recipient", "recipient_abn", "program", "category", "selection", "value", "published", "start", "end",
      "delivery_state", "fields", "source_url", "first_seen", "last_seen"];
    const updates = cols.filter((c) => c !== "id" && c !== "first_seen").map((c) => `${c} = excluded.${c}`);
    const insert = d.prepare(`INSERT INTO grants (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})
      ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`);
    const before = Number(d.prepare("SELECT COUNT(*) AS n FROM grants").get().n);
    d.exec("BEGIN");
    try {
      for (const r of rows) {
        const f = r.fields;
        const abn = f["Recipient ABN"].replace(/\s+/g, "");
        insert.run(r.id, f.Agency || "Unknown agency", f["Recipient Name"] || "Not published", /^\d+$/.test(abn) ? abn : null,
          f["Grant Program"], f.Category, f["Selection Process"], r.value, r.published, r.start, r.end, f["Delivery State/Territory"],
          JSON.stringify(f), r.sourceUrl, at, at);
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added: Number(d.prepare("SELECT COUNT(*) AS n FROM grants").get().n) - before };
  },

  async saveExpenses(rows: ExpenseRow[]) {
    const d = open();
    const at = now();
    const cols = [...EXPENSE_DB_COLUMNS, "amount_aud", "source_url", "first_seen", "last_seen"];
    const updates = cols.filter((c) => c !== "unique_id" && c !== "first_seen").map((c) => `${c} = excluded.${c}`);
    const insert = d.prepare(`INSERT INTO ipea_expenses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})
      ON CONFLICT(unique_id) DO UPDATE SET ${updates.join(", ")}`);
    const fresh = d.prepare("SELECT first_seen = ? AS fresh FROM ipea_expenses WHERE unique_id = ?");
    let added = 0;
    d.exec("BEGIN");
    try {
      for (const r of rows) {
        insert.run(...EXPENSE_COLUMNS.map((c) => r[c]), r.amount, r.sourceUrl, at, at);
        if (fresh.get(at, r.UniqueId)?.fresh) added++;
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added };
  },

  async saveStateGrants(rows: StateGrantRow[], replace: { years: true } | { programs: string[] } | null) {
    const d = open();
    const at = now();
    const cols = ["state", "financial_year", "id", "program_id", "agency", "agency_code", "program", "sub_program", "purpose", "recipient", "recipient_abn",
      "pooled", "recipient_type", "category", "assistance", "funding_source", "value", "agreement_total", "start", "end", "delivery_lga",
      "fields", "source_url", "first_seen", "last_seen"];
    const updates = cols.filter((c) => !["state", "financial_year", "id", "first_seen"].includes(c)).map((c) => `${c} = excluded.${c}`);
    const insert = d.prepare(`INSERT INTO state_grants (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})
      ON CONFLICT(state, financial_year, id) DO UPDATE SET ${updates.join(", ")}`);
    const count = () => Number(d.prepare("SELECT COUNT(*) AS n FROM state_grants").get().n);
    const before = count();
    const years = new Set<string>();
    let state = "";
    d.exec("BEGIN");
    try {
      for (const r of rows) {
        const g = r.grant;
        insert.run(r.state, r.year, r.id, r.programId, g.agency, g.agencyCode, g.program, g.subProgram, g.purpose, g.recipient, g.recipientAbn,
          g.pooled ? 1 : 0, g.recipientType, g.category, g.assistance, g.fundingSource, r.value, g.agreementTotal, g.start, g.end, g.deliveryLga,
          JSON.stringify(r.fields), r.sourceUrl, at, at);
        years.add(`${r.state}|${r.year}`);
        state = r.state;
      }
      const afterUpserts = count();
      // A line the source no longer carries, within what this load is the whole of, has been taken down.
      let removed = 0;
      if (replace && "years" in replace) {
        const trim = d.prepare("DELETE FROM state_grants WHERE state = ? AND financial_year = ? AND last_seen < ?");
        for (const y of years) { const [st, year] = y.split("|"); removed += Number(trim.run(st, year, at).changes); }
      } else if (replace && "programs" in replace && state) {
        const trim = d.prepare("DELETE FROM state_grants WHERE state = ? AND program_id = ? AND last_seen < ?");
        for (const programId of replace.programs) removed += Number(trim.run(state, programId, at).changes);
      }
      d.exec("COMMIT");
      return { added: afterUpserts - before, removed };
    } catch (e) { d.exec("ROLLBACK"); throw e; }
  },

  async stateGrantPrograms(state: string) {
    return open().prepare(`SELECT program_id AS programId, COUNT(*) AS count, SUM(value) AS total FROM state_grants
      WHERE state = ? GROUP BY program_id`).all(state).map((r) => ({ programId: r.programId as string, count: Number(r.count), total: Number(r.total) }));
  },

  async stateGrantRows(state: string): Promise<StateGrantRow[]> {
    return open().prepare("SELECT * FROM state_grants WHERE state = ? ORDER BY financial_year, id").all(state).map((r) => ({
      state: r.state, year: r.financial_year, id: r.id, programId: r.program_id, sourceUrl: r.source_url, value: Number(r.value),
      fields: JSON.parse(r.fields),
      grant: {
        agency: r.agency, agencyCode: r.agency_code, program: r.program, subProgram: r.sub_program, purpose: r.purpose,
        recipient: r.recipient, recipientAbn: r.recipient_abn, pooled: !!r.pooled, recipientType: r.recipient_type, category: r.category,
        assistance: r.assistance, fundingSource: r.funding_source, value: Number(r.value), agreementTotal: r.agreement_total,
        start: r.start, end: r.end, deliveryLga: r.delivery_lga,
      },
    }));
  },

  async saveReleases(rows: Release[]) {
    const d = open();
    const at = now();
    const cols = ["release_id", "cn_id", "ocid", "release_date", "tag", "initiation_type", "language",
      "award_id", "page_id", "award_date", "award_status",
      "agency_party_id", "agency", "agency_abn", "agency_branch", "agency_division",
      "supplier_party_id", "supplier", "supplier_abn", "supplier_street", "supplier_locality", "supplier_region", "supplier_postcode", "supplier_country",
      "title", "description", "contract_status", "date_signed", "value", "currency", "period_start", "period_end",
      "unspsc", "unspsc_scheme", "items", "tender_id", "procurement_method", "procurement_method_details",
      "limited_tender_exempt", "exemption_code", "exemption", "limited_reason_code", "limited_reason",
      "release", "first_seen", "last_seen"];
    const updates = cols.filter((c) => !["release_id", "cn_id", "first_seen"].includes(c)).map((c) => `${c} = excluded.${c}`);
    const insert = d.prepare(`INSERT INTO contract_releases (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(",")})
      ON CONFLICT(release_id, cn_id) DO UPDATE SET ${updates.join(", ")}`);
    const before = Number(d.prepare("SELECT COUNT(*) AS n FROM contract_releases").get().n);
    d.exec("BEGIN");
    try {
      for (const r of rows) {
        insert.run(r.releaseId, r.cnId, r.ocid, r.releaseDate, r.tag, r.initiationType, r.language,
          r.awardId, r.pageId, r.awardDate, r.awardStatus,
          r.agencyPartyId, r.agency, r.agencyAbn, r.agencyBranch, r.agencyDivision,
          r.supplierPartyId, r.supplier, r.supplierAbn, r.supplierStreet, r.supplierLocality, r.supplierRegion, r.supplierPostcode, r.supplierCountry,
          r.title, r.description, r.contractStatus, r.dateSigned, r.value, r.currency, r.periodStart, r.periodEnd,
          r.unspsc, r.unspscScheme, JSON.stringify(r.items), r.tenderId, r.procurementMethod, r.procurementMethodDetails,
          r.limitedTenderExempt, r.exemptionCode, r.exemption, r.limitedReasonCode, r.limitedReason,
          JSON.stringify(r.release), at, at);
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added: Number(d.prepare("SELECT COUNT(*) AS n FROM contract_releases").get().n) - before };
  },

  async backfillProgress(unit) {
    const r = open().prepare("SELECT unit, status, cursor, rows_added AS rowsAdded, calls, started, finished, error FROM backfill_progress WHERE unit = ?").get(unit);
    return r ? { ...r } as BackfillProgress : null;
  },

  async saveBackfillProgress(p: BackfillProgress) {
    open().prepare(`INSERT INTO backfill_progress (unit, status, cursor, rows_added, calls, started, finished, error) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(unit) DO UPDATE SET status = excluded.status, cursor = excluded.cursor, rows_added = excluded.rows_added,
        calls = excluded.calls, started = excluded.started, finished = excluded.finished, error = excluded.error`)
      .run(p.unit, p.status, p.cursor, p.rowsAdded, p.calls, p.started, p.finished, p.error);
  },

  async saveContracts(rows: Contract[]) {
    const d = open();
    const at = now();
    const insert = d.prepare(`INSERT INTO contracts (id, award_id, page_id, agency, supplier, supplier_abn, supplier_country, value, description,
        method, limited_reason, category_code, category_name, unspsc, start, end, published, late_days, first_seen, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET award_id = excluded.award_id, page_id = excluded.page_id, agency = excluded.agency,
        supplier = excluded.supplier, supplier_abn = excluded.supplier_abn, supplier_country = excluded.supplier_country,
        value = excluded.value, description = excluded.description, method = excluded.method, limited_reason = excluded.limited_reason,
        category_code = excluded.category_code, category_name = excluded.category_name, unspsc = excluded.unspsc,
        start = excluded.start, end = excluded.end, published = excluded.published, late_days = excluded.late_days, last_seen = excluded.last_seen`);
    let added = 0;
    d.exec("BEGIN");
    try {
      for (const c of rows) {
        const r = insert.run(c.id, c.awardId, noticePageId(c.awardId), c.agency, c.supplier, c.supplierAbn, c.supplierCountry, c.value, c.description,
          c.method, c.limitedReason, c.category.code, c.category.name, c.unspsc, c.start, c.end, c.published, c.lateDays, at, at);
        // SQLite reports one change for an insert and one for an update; first_seen tells them apart.
        if (d.prepare("SELECT first_seen = ? AS fresh FROM contracts WHERE id = ?").get(at, c.id)?.fresh && Number(r.changes) === 1) added++;
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added };
  },

  async contractsWithoutNotice(limit) {
    return open().prepare(`SELECT id, page_id AS pageId FROM contracts WHERE notice_read_at IS NULL AND page_id IS NOT NULL
      ORDER BY published DESC LIMIT ?`).all(limit);
  },

  async saveNotice(id, n: Notice) {
    open().prepare(`UPDATE contracts SET notice_read_at = ?, notice = ?,
        n_execution_date = ?, n_extension_options = ?, n_max_end_date = ?, n_atm_id = ?, n_australian_business = ?, n_sme_engaged = ?, n_nz_business = ?,
        n_suppliers_invited = ?, n_confidential_contract = ?, n_confidential_outputs = ?, n_consultancy = ?, n_limited_exemption = ?,
        n_supplier_country = ?, n_supplier_abn = ?
      WHERE id = ?`)
      .run(now(), JSON.stringify(n), n.executionDate, n.extensionOptions, n.maxEndDate, n.atmId, n.australianBusiness, n.smeEngaged, n.nzBusiness,
        n.suppliersInvited, n.confidentialContract, n.confidentialOutputs, n.consultancy, n.limitedTenderExemption,
        n.supplierCountry, n.supplierAbn, id);
  },

  async contradictions(limit): Promise<Contradiction[]> {
    // "Yes" to an Australian business, on a notice whose own supplier block says overseas or no ABN.
    return open().prepare(`SELECT id, page_id AS pageId, agency, supplier, value, description, published,
        n_supplier_country AS supplierCountry, n_supplier_abn AS supplierAbn, n_australian_business AS australianBusiness
      FROM contracts
      WHERE n_australian_business LIKE 'Yes%'
        AND (n_supplier_abn IS NULL OR n_supplier_abn NOT GLOB '*[0-9]*' OR (n_supplier_country IS NOT NULL AND UPPER(n_supplier_country) <> 'AUSTRALIA'))
      ORDER BY value DESC LIMIT ?`).all(limit);
  },

  async saveApsHeadcount(rows: ApsRow[]) {
    const d = open();
    const at = now();
    const insert = d.prepare(`INSERT INTO aps_headcount (release, agency, parent, gender, classification, headcount, source_url, first_seen, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(release, agency, gender, classification) DO UPDATE SET parent = excluded.parent, headcount = excluded.headcount,
        source_url = excluded.source_url, last_seen = excluded.last_seen`);
    const before = Number(d.prepare("SELECT COUNT(*) AS n FROM aps_headcount").get().n);
    d.exec("BEGIN");
    try {
      for (const r of rows) insert.run(r.release, r.agency, r.parent, r.gender, r.classification, r.headcount, r.sourceUrl, at, at);
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return { added: Number(d.prepare("SELECT COUNT(*) AS n FROM aps_headcount").get().n) - before };
  },

  async startRun() {
    return Number(open().prepare("INSERT INTO runs (started_at) VALUES (?)").run(now()).lastInsertRowid);
  },

  async finishRun(id, results: RunResult[]) {
    const failed = results.filter((r) => !r.ok).length;
    open().prepare("UPDATE runs SET finished_at = ?, ok = ?, saved = ?, failed = ?, detail = ? WHERE id = ?")
      .run(now(), failed === 0 ? 1 : 0, results.length - failed, failed, JSON.stringify(results), id);
  },

  async saveFuelPrices(state: string, rows: FuelPrice[]) {
    const d = open();
    const at = now();
    const insert = d.prepare(`INSERT OR REPLACE INTO fuel_prices
      (state, site_id, fuel, fuel_raw, name, brand, address, suburb, postcode, lat, lng, price, reported_at, captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    d.exec("BEGIN");
    try {
      d.prepare("DELETE FROM fuel_prices WHERE state = ?").run(state);
      for (const r of rows) insert.run(state, r.siteId, r.fuel, r.fuelRaw, r.name, r.brand, r.address, r.suburb, r.postcode, r.lat, r.lng, r.price, r.reportedAt, at);
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    return rows.length;
  },

  async stats(): Promise<DbStats> {
    const d = open();
    const count = (table: string) => Number(d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    const run = d.prepare("SELECT started_at, finished_at, ok, saved, failed FROM runs ORDER BY id DESC LIMIT 1").get();
    return {
      location: path.relative(process.cwd(), FILE).replace(/\\/g, "/"),
      series: count("series"), observations: count("observations"), snapshots: count("snapshots"), companies: count("companies"),
      contracts: count("contracts"), noticesRead: count("contracts WHERE notice_read_at IS NOT NULL"),
      fuelPrices: count("fuel_prices"),
      apsRows: count("aps_headcount"), apsReleases: Number(d.prepare("SELECT COUNT(DISTINCT release) AS n FROM aps_headcount").get().n),
      expenses: count("ipea_expenses"),
      stateGrants: count("state_grants"),
      grants: count("grants"),
      contractReleases: count("contract_releases"),
      lastRun: run ? { startedAt: run.started_at, finishedAt: run.finished_at, ok: !!run.ok, saved: run.saved, failed: run.failed } : null,
    };
  },
};
