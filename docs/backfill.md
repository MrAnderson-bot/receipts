# Backfill: getting the whole history into the database

Written 25 September 2026 from an audit of every source module, the snapshot job and the database as it
stood that day. The aim is a complete record from the earliest date each publisher offers, so government
performance can be read for past years and past governments the same way the scorecard reads it today.

The workflow is deliberately slow: **one unit a night, inside the nightly publish**, where a unit is one
source for one financial year (or one release, for sources that come in releases). The full backfill takes
a few months of nights. Nothing here needs a bigger VM.

## What we have today and what is missing

"Have" is what the database held on 25 September 2026. "Available" is what the publisher offers.

### Already complete (no backfill needed)

| Source | Have | Notes |
|---|---|---|
| Budget totals (payments, balance, net debt, net interest, receipts share, real payments growth, net capital investment) | 1970-71 to the latest final outcome | Budget Paper 1 historical tables carry the whole run |
| Commonwealth receipts by tax line (Treasury) | 2005-06 onward; share of GDP since 1978-79 | Table 11.3 could extend taxation receipts to 1970-71, low value |
| Commonwealth asset sales (Finance) | every sale since the 1980s | one page |
| Migration (Home Affairs, ABS) | program outcomes since 1984-85, temporary visas since 2001-02, NOM since 2004-05 | full history is inside the current files |
| Crime and homelessness (ABS, AIHW) | victims since 1993, offenders since 2008-09, SHS since 2011-12 | full history inside the current releases |
| Tax by level of government (ABS 5506.0) | about ten years in the current release | older releases exist on the ABS site; low value |

### Missing history, and where it is

| Source | Have | Available | Backfill unit | Units | Cost per unit |
|---|---|---|---|---|---|
| **ABS and RBA series** (35 indicators) | from 2016 (mortgage rate 2019, AUD 2023) | ABS Data API back to the 1970s for most series (Labour Force from 1978-02); RBA CSVs back decades; AOFM from 2010 | one run: change each spec's `from` and re-fetch | 1 | one API call per series, seconds |
| **Budget expenses by function and by program** | current Budget only (all estimates) | one data.gov.au dataset per Budget, 2014-15 to 2026-27 (13 Budgets), each with its expenses-by-function table and program expenses spreadsheet | one past Budget | 13 | one zip and one spreadsheet, a minute |
| **Actual expenses by function** | none (Finance's table is estimates only) | ABS Government Finance Statistics (5512.0): Commonwealth expenses by purpose, actuals, annual since 1998-99, one spreadsheet | new source, one run, then yearly | 1 | one spreadsheet |
| **Companies (ATO transparency)** | income year 2023-24 only (4,110 rows, plus 88 late) | one spreadsheet per income year, 2013-14 to 2023-24 | one income year | 10 | one spreadsheet, about 2,000 to 4,000 rows |
| **Contracts (AusTender)** | notices published from 24 June 2026 (16,102 rows) | the API's `findByDates` accepts any window; notices exist from July 2007 (51 in that first month), roughly 80,000 a year now | one financial year, walked month by month, resumable | 19 (2007-08 to 2025-26) | about 800 API calls at 100 notices a page; 15 to 30 minutes at a polite rate; about 50 MB of rows |
| Contract notice pages (the `n_*` fields) | 3,677 of 16,102 read | every notice has a public page | continues at the nightly `NOTICE_BUDGET` (1,500 a night) | ongoing | 1.5 million pages at the polite crawl rate is about three and a half days of continuous reading; see "Notice pages" below |
| **State grants (Queensland QGIP)** | latest financial year stored in full, the year before as totals only | one consolidated CSV per financial year, 2012-13 to 2024-25, all on the one dataset page | one earlier year per night through `saveStateGrants` | 12 | one 15 to 25 MB CSV each, 30,000 to 45,000 rows |
| **State grants (NSW finder)** | every published award since 2022, filled incrementally: `NSW_GRANT_BUDGET` grants a night (default 250), changed or new grants first | nothing older: the finder began publishing awards in September 2022 | none needed beyond the nightly job; the first fill takes about four nights | 0 | about 120 scan requests plus up to a few hundred award pages a night, one reader, 500 ms apart, under the site's CloudFront rate rule |
| **Grants (GrantConnect)** | summaries only, 7/30/90-day windows; no per-record table | the report download accepts any publish-date window (tested: 751 awards in the first week of 2019); GrantConnect began December 2017 | first a `grants` table (the handover's next per-record step), then one financial year, month by month | 9 (2017-18 to 2025-26) | 12 spreadsheet downloads, about 40,000 rows a year |
| **Parliamentarians' expenses (IPEA)** | last 5 quarters (`QUARTERS` in `lib/sources/ipea.ts`) | quarterly extracts on data.gov.au since IPEA began in July 2017 | one quarter | about 32 | one CSV |
| **APS headcount (APSC)** | 4 releases, June 2024 onward, plus the twenty-year totals | half-yearly releases on data.gov.au going back years | one release | depends on the catalogue, roughly 20 | one spreadsheet |
| **Parliament (They Vote For You)** | nothing stored; the page reads live | divisions and every member's vote since 2006 through the API | one calendar year of divisions | 20 | hundreds of API calls; third-party, CC BY-SA, rate unknown, so be polite and check the licence before any paid use |
| **State contracts** | snapshots of a rolling window only; no per-record tables | NSW: buy.nsw API takes any date range. ACT: Socrata invoices dataset, any date. NT: one export of every award since 2012. WA: one file per financial year on data.wa.gov.au (newest 2023-24). QLD: agency files on data.qld.gov.au, patchy. TAS: last 30 days only, no history. VIC: hand-gathered, no history | a `state_contracts` table first, then NT in one run, and one financial year each for NSW, ACT, WA, QLD | NT 1; NSW, ACT, WA, QLD a few each | one file or a few API pages |
| **Fuel prices** | state-level daily figures from September 2026 | NSW FuelCheck monthly price files on data.nsw.gov.au since 2016; QLD monthly files since December 2018; WA FuelWatch historical downloads by month since 2001 | one state for one month, stored as the same state-level daily figures (median, cheapest, dearest, count), not station rows | NSW about 120, QLD about 90, WA about 300 | one file each; keep station rows out, per the disk rule |

### Not backfillable

South Australia and Victoria contracts (blocked sites), Tasmania beyond 30 days, NT and ACT fuel, ASX company
earnings, and the Final Budget Outcome as its own document (PDF only). The scorecard itself has no history to
backfill: it is recomputed from the series, so once the series are deep the scorecard can be read for any past
date by running the rules at that date (see "Reading the past").

## Priority order

Ordered by how much each adds to "how did the country do, and under whom", against its cost.

1. **Series depth** (1 unit). Every scorecard rule, the recession watch and the economy charts immediately
   read back to the 1970s or 1980s. One night.
2. **Actual expenses by function, ABS GFS** (1 unit). The only actuals by purpose; fills the "Budget page only
   shows the current year" gap.
3. **Past Budgets by function and program** (13 units). Shows what each Budget planned and how the plan moved.
4. **Companies by income year** (10 units). Makes the ABN cross-link usable over time.
5. **Contracts, newest financial year first** (19 units, multi-night each). The core spending record.
6. **Grants table, then grants by year** (1 + 9 units).
7. **IPEA quarters** (about 32 units, fast).
8. **APS releases** (about 20 units, fast).
9. **Parliament divisions by year** (20 units). Third-party; last because of licence questions.
10. **State contracts** (table, then NT, then NSW, ACT, WA, QLD by year).
11. **Fuel history** (hundreds of small units, lowest value per unit; only if the rest is done).

Contracts and grants are walked **newest year first**, because recent years are compared most, and a recent
year is the one whose notice pages are still cheap to read (agency pages for 2010 notices may be gone).

## How it runs

### One unit a night, inside the publish

The nightly publish already runs `runSnapshot()` in `app/api/snapshot/route.ts` during the static export.
Add a second phase after it: `runBackfill()`, which

1. reads the `backfill_progress` table to find the first unit in the priority list that is not `done`;
2. runs it with a **time budget** (default 20 minutes, `BACKFILL_MINUTES`), well inside the build's 30-minute
   page limit;
3. writes progress as it goes (for month-walked units, the month reached), so a unit that runs out of time
   resumes next night from where it stopped;
4. records rows added, calls made and time taken in `runs`, the same as a snapshot step.

Set `BACKFILL=0` on the VM to pause it. Nothing else changes: the same loaders, the same `Store` interface, the
same first-seen and last-seen handling, so a revised historical figure is kept as a revision like any other.

### Faster on the dev machine when wanted

The same `runBackfill()` is exposed while `next dev` runs, at `/api/backfill?unit=<id>` (local only, like the
snapshot route today), so a unit can be run by hand ahead of the schedule. The database file is then copied to
the VM once, in place of that night's copy (`deploy/publish.sh` backs up before it pulls, so nothing is lost).
Only one process writes the database at a time: pause the VM's backfill (`BACKFILL=0`) while the dev machine
is running units, and copy the file up before turning it back on.

### Progress table

    backfill_progress (
      unit        TEXT PRIMARY KEY,   -- e.g. contracts:FY2024-25, budget:2019-20, companies:2016-17, ipea:2019Q03
      status      TEXT,               -- pending | running | done | failed
      cursor      TEXT,               -- where a walked unit got to, e.g. 2024-11 (the month completed)
      rows_added  INTEGER,
      calls       INTEGER,
      started     TEXT, finished TEXT,
      error       TEXT
    )

Units are seeded from the priority list in code, so adding a source means adding its units to that list.
A `failed` unit is retried the next night after every pending one, so one broken source can't block the rest.

### Unit definitions

| Unit id | Does |
|---|---|
| `series:depth` | Re-fetch every ABS, RBA and AOFM spec with its earliest `from` (set per spec; ABS `1970`, RBA table start) and `saveSeries`. Idempotent. |
| `gfs:functions` | New `lib/sources/abs-gfs.ts`: read the 5512.0 Commonwealth expenses-by-purpose table; store one yearly series per purpose (`gfs:<purpose>`) and a `gfs` snapshot. Re-run yearly when the release lands. |
| `budget:<year>` | Read that Budget's data.gov.au dataset with the existing `budget.ts` parser (it already finds tables by title, which is why it survives layout changes); store a `budget/<year>` snapshot and, for each function, the estimates as that Budget saw them (`budget-fn:<function>:as-at-<year>`). The 2014-15 to 2016-17 datasets have 100+ files; match the Budget Paper 1 zip and the program spreadsheet by name as now. |
| `companies:<income year>` | Read that year's spreadsheet with `readYear` and `saveCompanies`; the table is keyed by ABN and income year so nothing is overwritten. |
| `contracts:FY<yyyy-yy>` | Walk `findByDates` month by month from June back to July of that financial year (newest first), `saveContracts` each month, cursor = month done. Politeness: one page a second, `next: { revalidate }` off. Amendments go to the same table with their `-A` ids, as today. |
| `grants:table` | Add the `grants` table (every column the report gives, one row per award, keyed by GA id) and `saveGrants`; switch the nightly 90-day step to store rows. |
| `grants:FY<yyyy-yy>` | Twelve report downloads, one a month, `saveGrants` each. |
| `ipea:<yyyy>Q<qq>` | `readQuarter` for that extract and `saveExpenses`; keyed by `unique_id`. |
| `aps:<release date>` | `loadAps` for one release and `saveApsHeadcount`; keyed by release, agency, gender, classification. |
| `parliament:<year>` | New `divisions` and `votes` tables; read that year's divisions and each member's vote through the TVFY API, politely (their terms give no rate; stay under one call a second and stop on a 429). Store the source URL on every row for CC BY-SA attribution. |
| `states:table` then `state:<code>:<FY>` | A `state_contracts` table shaped like `contracts` plus `state`; NT loads everything in one unit; NSW, ACT and WA by financial year; QLD by year from the files present. |
| `fuel:<state>:<yyyy-mm>` | Read the month's historical file, compute the same daily state-level figures the snapshot keeps, `saveSnapshot("fuel", code, ...)` per day. No station rows. |

### Notice pages

The `n_*` fields come from reading each notice's public page, and that crawl is the one thing that can't be
hurried without being rude to tenders.gov.au. Keep the existing polite settings and let it run newest-first
every night; the backlog simply grows as contracts are backfilled and drains at 1,500 a night. If a
faster catch-up is ever wanted, raise `NOTICE_BUDGET` on the dev machine for a weekend rather than on the VM,
and never above two pages in flight. Pages for notices older than a few years may be gone; a 404 is recorded
in `notice_read_at` with a null notice so it is not retried.

## Disk, backups and the VM

Measured on 25 September 2026: the VM has a 20 GB disk with 9 GB free; the database is 139 MB; a contract row
is about 600 bytes from the API plus about 900 bytes once its notice page is read.

| | Size |
|---|---|
| All contracts, 2007 to now, API fields | about 1.3 GB with indexes |
| The same with every notice page read | about 2.7 GB |
| Grants, 2017 to now | about 0.3 GB |
| Everything else in this document together | well under 0.5 GB |
| **Total** | **about 3.5 GB, on the existing disk, with 5 GB to spare** |

So the VM stays as it is. Two rules that must hold:

1. **Bucket lifecycle.** `deploy/publish.sh` copies the database to the bucket every night under a dated name
   and never deletes. With a 3 GB file that is 90 GB a month, growing forever. Set a lifecycle rule on
   `the backup bucket` to delete objects older than 14 days before the contracts backfill
   starts. About 45 GB at most, roughly a dollar a month in Sydney.
2. **Station rows stay daily-only.** The fuel history units store state-level figures, never station rows.
   The one existing exception (today's station prices, replaced daily) stays the only one.

If state contracts and notice pages both reach their full size and the disk passes 15 GB used, resize the
disk to 30 GB (`gcloud compute disks resize`, no downtime, a few dollars a month more). No memory or CPU
change is needed: the site build reads the live 90-day window, not the history, and SQLite handles a few
gigabytes on an e2-micro for the indexed lookups the pages make.

## Reading the past

Once the series are deep, "how was the government doing in June 2019?" is the scorecard run with every
series cut off at that date, and "who did what" is the same over the dates of each government. That needs
two things beyond the backfill:

- `scorecard(results, budget, contracts, asAt)`: every rule already reads "latest" and "a year earlier"; add
  a cut-off so "latest" means the last observation on or before `asAt`. Budget rules use the final outcome for
  the year ending before `asAt`. Procurement rules use the 90 days before `asAt` from the `contracts` table.
- A fixed table of federal governments and their dates, now in `lib/governments.ts` (Whitlam to Albanese,
  National Archives source, `governmentOn(date)`), so a period can be labelled. That is a statement of dates, not of credit or blame, and the
  page should say what the handover says: outcomes follow policy with a lag, and some of these figures are
  set by the Reserve Bank, the states or the world rather than the government of the day.

Estimates and revisions are kept apart: a Budget's forward estimates are stored as what that Budget said at
the time, never as history, so a chart of "estimated versus actual" is possible later.

## Licences to confirm before any paid use

They Vote For You (CC BY-SA), NSW and Tasmanian contract registers (unconfirmed), the Victorian snapshot.
Everything else in this document is CC BY 4.0 or an equivalent government licence.

## Progress log

Record here, with the date, when each unit family starts and finishes, and any change to the plan.

- 25 September 2026: plan written. Nothing started.
- 25 September 2026: `contracts:FY2025-26` started, the first unit run. `npm run backfill -- <unit>` (plain Node, resumable,
  `backfill_progress` table). It reads `contractLastModified` in 7-day windows, newest first, into the new `contract_releases`
  table (one row per release, every API field; see `docs/query-audit.md`), and the original notices into `contracts`.
- 25 September 2026: `contracts:FY2025-26` done in 46 minutes, 1,318 API calls: 123,770 release rows (76,137 original
  notices, 47,633 amendments across 22,331 contracts). The database grew from 138 MB to 725 MB, about twice the plan's
  estimate per year, because each amendment repeats the whole release JSON. Decide before the next year whether to keep
  the `release` JSON column (every field already has its own column) or budget the disk for it.
