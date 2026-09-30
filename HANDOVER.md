# Receipts: handover

Last updated 30 September 2026. For how each data source works and its quirks, see `README.md`. This file covers
where the project stands, the database, decisions already made, and what to do next.

## What this is

A dashboard of the Australian economy and government money, built only on official sources, where every figure
links back to its record. The end goal is a prediction engine: change a policy setting or a spending figure and see
the modelled effect on the economy. The engine has not been started. Everything so far is the data layer under it.

Open source, neutral in tone. Commentary belongs on the owner's own channels, not in the repo. Criticise systems
and agencies, never named public servants. Publish the method for every claim.

## Run it

    npm install
    npm run dev -- -p 3070        # 3000 to 3060 are usually taken on this machine
    npm run snapshot              # store today's figures in the database AND build the public site into out/
    npm run backfill -- contracts:FY2025-26   # one unit of history into the database, resumable (docs/backfill.md)

`npm run snapshot` is a static export (`STATIC_EXPORT=1 SNAPSHOT=1 next build`). The snapshot runs inside the
build, in `app/api/snapshot/route.ts`, because the source loaders use Next's cache and can't run outside a Next
process. Stop the dev server before running it; both use `.next`.

`npm run backfill` runs outside Next, in plain Node (`scripts/ts-loader.mjs` lets Node load the project's TypeScript), so it
can run while the dev server is up. It fills one unit of history at a time and resumes from its cursor if stopped.

Needs Node 22.5 or later (built-in SQLite). Developed on Node 24. There are no tests.
Public repository: https://github.com/MrAnderson-bot/receipts (AGPLv3, `LICENSE` in place). `docs/HANDOVER-launch.md`
and `docs/launch-tools/` are owner-only and git-ignored.

## Pages

| Route | Shows |
|---|---|
| `/` | Headline indicators, Commonwealth revenue, last 7 days of contracts |
| `/economy` | Recession watch (five signals with fixed rules, no invented probability), then 35 indicators with history: recession signals (Sahm rule, yield curve, 10-year bond), growth, prices and rates, cost of living (real wages, rents, electricity, gas, groceries, fuel, new mortgage rate, mean home price, household debt to income, credit card debt), housing supply (approvals, completions, population growth, new residents per new dwelling), jobs (unemployment, participation, underemployment, wages, productivity, profits), households, government investment and gross debt as shares of GDP |
| `/scorecard` | Government scorecard: 26 KPIs in six groups (affordability, housing supply, jobs and growth, budget and debt, investment, procurement), each a fixed rule over an official figure, met/missed/no data. Score out of 100 = share of readable rules met, per group and overall, plus the same over the government's published targets only; every missed rule says what has to change, listed weakest group first as "what would lift the score". Design, rules and gaps in `docs/kpi-scorecard.md` |
| `/revenue` | Commonwealth receipts by source, share of GDP, taxes by level of government |
| `/budget` | Budget balance, expenses by function, net debt, largest programs, gross debt, and every Commonwealth asset sale since 1987 with the government of the day, totals by government and by party, the unit that ran the sale, and the buyer of every trade sale with the official record that names it (hand-gathered list in `lib/sources/asset-sale-buyers.ts`, method in `docs/asset-sale-buyers.md`) |
| `/companies` | Tax Office transparency list (about 4,100 large companies), company profits by industry |
| `/spending` | Commonwealth contracts: late reporting, limited tender, agencies, suppliers (nav label "Contracts"). `/spending/7`, `/spending/90` for other ranges |
| `/categories` | What contracts buy, by UNSPSC segment (same `/7`, `/90` ranges) |
| `/grants` | Commonwealth grant awards (same ranges) |
| `/expenses` | Parliamentarians' work expenses, latest quarter vs a year earlier (IPEA): categories, parties, states, top 20 people, largest lines. Every line stored in `ipea_expenses` |
| `/states` | NSW, VIC, QLD, WA, NT, TAS contracts and ACT invoices. `/states/QLD` etc. |
| `/state-grants` | State grant payments: agencies, recipients, programs, categories, assistance types, funding source, change on the year before. NSW's Grants and Funding Finder awards (`/state-grants/NSW`, read from the nightly snapshot only: the finder is walked a few hundred grants a night under its rate rule, `NSW_GRANT_BUDGET`), Queensland's whole-of-government file (`/state-grants/QLD`) and Lotterywest's approved grants for WA (`/state-grants/WA`); the other five jurisdictions are listed with the reason each can't be read, found by probing every one on 25 September 2026. Every line stored in `state_grants` |
| `/fuel` | Fuel prices per state from the state price reporting schemes: median and cheapest unleaded and diesel, cheapest stations, and which schemes are waiting on a key. WA and Queensland work without one |
| `/migration` | Net overseas migration, temporary visa holders, permanent program, skilled and working holiday grants, citizenship by country |
| `/crime` | Victims of recorded crime by offence and state (ABS, since 1993), offenders by principal offence and state (ABS, since 2008-09), people homeless on Census night (ABS) and people helped by homelessness services with reasons (AIHW, since 2011-12) |
| `/parliament` | Every MP and senator: divisions attended, votes against their party, by party and by house. They Vote For You, third-party, needs `TVFY_API_KEY` (the older name `THEY_VOTE_FOR_YOU_API_KEY` in `.env.local` also works) |
| `/revisions` | Every stored figure a publisher changed after first publication (first value, current value, when each was seen), grouped by publisher; and contract amendments in the last 90 days matched to the original notice to show how much each contract grew |
| `/government` | APS headcount from the APSC's half-yearly releases on data.gov.au: total and change, by gender and level, 15 largest agencies, twenty-year history. Every cell of the agency table is stored in `aps_headcount`. Gross debt (AOFM securities on issue) is on `/budget` |
| `/sources` | Every feed with live status, database totals, and what isn't connected |

## How the code is laid out

- `lib/sources/*.ts`: one module per source. Each exports a `tryGet...()` that returns `{ data, error }` and never
  throws, so one dead source can't blank a page. States live in `lib/sources/states/` and share `StateSummary`.
- `lib/economy.ts`: which indicators exist and how they are grouped. Add one by adding an entry to `ABS_SERIES` or
  `RBA_SERIES` and its id to a group. A spec's `multiply` turns a publisher's thousands or $ millions into ones.
- `lib/derived.ts`: indicators worked out from other series (new residents per new dwelling, yield curve, Sahm rule).
  Each names its inputs and states its method in the note. `getIndicators` fetches the inputs and builds them; they
  are stored and snapshotted like any other series.
- `lib/scorecard.ts`: the government scorecard, built the same way as the recession watch. Each KPI is a fixed rule
  over a stored series, a Budget table column or the 90-day contract summary, returning met, missed or no data; the
  count is "met X of Y readable", never a weighted score. `basis` marks whether the rule is the government's own
  published target (Housing Accord, inflation band, gross debt trajectory) or our yardstick. Thresholds are
  constants at the top of the file and the rule text is built from them. Why each rule exists, what data it
  needs and what isn't tracked yet is in `docs/kpi-scorecard.md`; record any threshold change there with the date.
- `docs/backfill.md`: the plan for filling the whole history, source by source, one unit a night inside the
  publish. Read it before adding history to anything; it records what each publisher offers and the disk rules.
  **Running on the VM since 25 September 2026:** `receipts-backfill.service` runs `deploy/backfill.sh`, a loop
  that calls `npm run backfill -- <unit>` for every unit in the plan's order, ten minutes a pass, pausing while
  the nightly publish runs. Units (`lib/db/backfill.ts`): `series:depth` (every ABS/RBA/AOFM series from the
  earliest period), `gfs:all` (Commonwealth expenses by purpose from each ABS Government Finance Statistics
  release, `gfs:<purpose>` series), `budget:all` (every Budget since 2014-15: program expense lines as a
  `budget-programs` snapshot and `budget-portfolio:<name>:as-at-<year>` series; older zips carry no
  expenses-by-function table), `companies:all` (ATO list per income year since 2013-14),
  `contracts:FY<yyyy-yy>` (newest first, 2025-26 to 2007-08), `grants:FY<yyyy-yy>` (new `grants` table,
  every report column, 2025-26 to 2017-18), `ipea:all` (every quarterly extract), `aps:all` (every half-yearly
  release the reader understands; 2013 and earlier use another table layout and are skipped). Units run in
  plain Node, so they call each source's raw loader, never the `unstable_cache` one. Not built: parliament
  divisions, state contracts, fuel history. Check it with `.\deploy\backfill-status.ps1`
  (`-Stop` and `-Start` to pause and resume); install or update it with `deploy/vm-install-backfill.sh`. The
  backup bucket deletes copies older than 14 days (lifecycle rule set the same day).
- `lib/governments.ts`: federal governments by date (prime minister, party, sworn-in dates, National Archives
  source) with `governmentOn(date)`. Used to label asset sales with the government of the day; reuse it for
  anything else that needs "under which government". Dates only, no judgement in the wording.
- `lib/recession.ts`: the recession watch. Five signals (Sahm rule, yield curve, GDP, GDP per person, real household
  spending), each a fixed rule over a stored series with watch and triggered thresholds, summed into Low, Elevated or
  High. It is a checklist, not a model; the method text on the page is the contract. Change a threshold there and
  the page text changes with it.
- `lib/xlsx.ts`, `lib/csv.ts`: dependency-free spreadsheet, zip and CSV readers, plus `USER_AGENT`.
- `lib/db/`: the database (below).
- `components/LineChart.tsx`: the only chart. Single series, hover and keyboard readout.
- Caching: small responses use Next's fetch cache. Large downloads are parsed and the summary cached with
  `unstable_cache`. Changing a cached loader's code invalidates its cache; states also have a `REVISION` map in
  `lib/sources/states/index.ts` to refresh one state without re-reading the rest.

## The database

Local SQLite at `data/receipts.db`, created automatically on first use. It exists so figures can be compared over
time, revisions can be seen, and the prediction engine has history to train and test on. Pages do not read from it
yet; they still read the live sources. It is ignored by git and can be rebuilt at any time with `npm run snapshot`.

| Table | Holds |
|---|---|
| `series` | One row per time series: label, unit, frequency, source, source URL |
| `observations` | `series_id`, `period`, `value`, `first_seen`, `last_seen`. If a publisher revises a period, the new value is a new row, so the old value is kept. The current value for a period is the row with the latest `last_seen` |
| `snapshots` | One JSON summary per `source`, `key` and day: contracts and grants (7, 30, 90 days), each state, budget, revenue, companies, company profits, tax by level |
| `companies` | The full Tax Office list: `abn`, `name`, `income_year`, `income`, `taxable`, `tax`. Indexed by ABN for joining to suppliers and grant recipients |
| `state_grants` | Every line of a state's published grant list: `state`, `financial_year`, `id`, the fields every state shares as columns (agency, program, recipient, ABN, category, assistance, funding source, value, dates), and every published column as JSON in `fields`. Queensland's file is republished whole, so its rows are keyed by position and a vanished line is deleted on the next load; NSW's register is walked whole, keyed by grant and award id, and an award taken down is deleted; Lotterywest's list rolls forward, so its rows are keyed by the grant's own facts and accumulate. `first_seen` survives an update |
| `fuel_prices` | Every station's current price, one row per state, station and fuel, every field the scheme gives. **Replaced each day, not accumulated**: it is the one deliberate exception to keeping every record, because six states of stations at several fuels each is thousands of rows a day and the VM's disk is small. The daily history is the state-level `fuel` snapshot (median, cheapest, dearest and station count per fuel). Revisit if the database moves off the VM |
| `runs` | Each snapshot run: times, how many sources saved or failed, and the detail |

Period formats: `2026-07` monthly, `2026-Q2` quarterly, `2026-09-18` daily, `FY2024-25` financial year (the prefix
stops `2011-12` reading as December 2011). Money is stored in dollars, not millions. Only final outcomes are stored
as observations; Budget estimates stay inside the dated `budget` snapshot because they change with every Budget.

After the first run: 37 series, 2,361 observations, 18 snapshots, 4,198 companies, 30 of 30 sources saved.

How it runs: `GET /api/snapshot` calls `runSnapshot()` in `lib/db/snapshot.ts` when the process has `SNAPSHOT=1`;
`npm run snapshot` runs a static export with that set, so the route is rendered once during the build and the
snapshot happens then. In the exported site, `out/api/snapshot` is a plain JSON file of database totals; nothing
public can trigger a run. On the VM, `deploy/receipts-publish.timer` runs it every morning.

### Moving to Supabase later

Everything goes through the `Store` interface in `lib/db/types.ts`. To switch:

1. Create the five tables in Postgres. The SQLite schema in `lib/db/sqlite.ts` maps across directly (`REAL` to
   `double precision`, `TEXT` dates to `timestamptz`, the JSON `payload` to `jsonb`).
2. Write `lib/db/supabase.ts` implementing `Store`.
3. Return it from `getStore()` in `lib/db/index.ts`. Nothing else changes.
4. Replace the local-only endpoint with a scheduled job (Vercel Cron or a Supabase scheduled function) protected by
   a secret, since it will then be reachable from the internet.
5. To bring existing history across, read each table from `data/receipts.db` and insert it through the new store.

## Hosting plan (decided 19 September 2026)

This replaces the Supabase and Vercel Cron route above unless there is a reason to go back to it.

- **Engine room: one small Google Cloud VM, running all the time, not reachable from the internet.** It runs the
  nightly snapshot on a timer, keeps the SQLite file on its own disk, runs the models, builds the site as plain
  files and pushes them out. Back the database file up to Google Cloud Storage every day: the VM's disk is the only
  copy of the history.
- **Public site: Cloudflare Pages**, static files only, no server and no database behind it. Chosen because the
  deploy tooling is already set up on the owner's machine, static bandwidth is free, and Vercel's free tier is
  non-commercial.
- **"What if" sliders run in the visitor's browser** from a small file of model figures the VM publishes. Only add a
  public service on the VM if a model is too heavy for a browser, and rate-limit it if so.
- **Done on 22 September 2026:** the app builds as a static export (`npm run snapshot` produces `out/`), and the
  VM's job is written: `deploy/vm-setup.sh` (one-time), `deploy/publish.sh` (nightly: pull, snapshot + build, push to
  Cloudflare Pages, back the database up to Cloud Storage), and the systemd timer at 04:30 Canberra time. The pages
  still read the live sources at build time; reading from the database (step 4 below) is a later improvement, not a
  blocker.
- **Live since 22 September 2026**, all under the owner's own accounts, never a company's, and everything in Sydney.
  Account, project, VM and bucket names are in the owner-only `docs/HANDOVER-launch.md` (git-ignored):
  - Public site: https://receipts-byv.pages.dev (Cloudflare Pages project `receipts`, classic Pages, created with
    `--force` because wrangler otherwise tries to convert a Next.js app to its Workers adapter and edits the repo;
    if that ever happens again, revert `next.config.mjs`, `package.json` and delete `wrangler.jsonc`,
    `open-next.config.ts`, `public/_headers`, `.dev.vars`).
  - One Google Cloud project with one VM (e2-micro, `australia-southeast1-b`, Debian 12, about AUD 10-12 a month)
    and one backup bucket. The default SSH/RDP/ICMP firewall rules are deleted; SSH only through IAP:
    `gcloud compute ssh <vm> --zone australia-southeast1-b --tunnel-through-iap`.
  - On the VM: repo at `/opt/receipts`, job user `receipts`, `receipts-publish.timer` at 04:30 Canberra time. Secrets
    in `/etc/receipts.env`. Logs: `journalctl -u receipts-publish`.
  - Until the VM has a Cloudflare API token in `/etc/receipts.env`, deploy by hand from the dev machine:
    `npm run snapshot && npx wrangler pages deploy out --project-name receipts --branch main`.
  - Not done: a custom domain on the Pages project.
- Every page carries an "Under development" banner (`components/DevBanner.tsx`) listing what has been collected and
  saying it may be incomplete. Keep it until the figures have been spot-checked.
- **Migration (ported from the AID project on 22 September 2026, `Projects\AID`, repo `REKT369/AID`; its owner gave
  permission to use it).** `lib/sources/migration.ts` reads the four Home Affairs pivot exports AID used (BP0019 temporary
  visa holders, BP0014 skilled grants, BP0017 working holiday grants, BP0068 permanent program outcomes) plus the
  Australian Migration Statistics package (tables 1.0, 2.0, 5.0, 5.1, 6.0), and takes net overseas migration from the ABS
  Data API (`NOM_FY`, key `3.TOT.3.AUS.A`). Differences from AID, on purpose: files are found through the data.gov.au
  catalogue (AID hard-coded dated URLs; Home Affairs replaces each file in place every release); AID's three hand-typed
  JSON files (NOM, citizenship history, an "arrivals counter" that extrapolated a daily rate) are not carried over, because
  they were not read from a published file. Citizenship therefore shows only table 6.0 (top 15 countries, latest year), and
  NOM by visa category comes from the package tables rather than AID's unsourced numbers. Suppressed "<5" cells are
  treated as missing and said so on the page. Reading notes for the engine are in `docs/prediction-engine-reading.md`.
- **Dev-server quirk:** the first cold render of `/migration` under `next dev` logs "failed to pipe response: Maximum call
  stack size exceeded" and sends a truncated page; every request after that is complete, and the production static build
  is fine. It happens while the 20 MB skilled-visas file is downloaded inside the render and looks like a dev-only cache
  behaviour. Not investigated further because the deployed site never uses the dev server.

## Decisions already made (please don't undo without a reason)

- **Official sources only, identified honestly.** Every request uses `USER_AGENT`, which names this project using the
  `Mozilla/5.0 (compatible; ...)` convention crawlers use. No pretending to be a browser to get past bot checks.
- **Parliamentary Budget Office data is not used.** Its licence is non-commercial, no derivatives. Treasury and
  Finance publish the same figures under CC BY.
- **Cloudflare's crawler can't reach Victoria, SA or ACT tender sites.** It identifies itself as a bot and is
  challenged like any other program.
- **Asset sale buyers are a hand-gathered list** (`lib/sources/asset-sale-buyers.ts`), because no official page names
  purchasers in one place. Every entry links to the ANAO report, Hansard or ministerial release that names the buyer;
  a sale with no entry shows "not traced". Method and rules in `docs/asset-sale-buyers.md`.
- **Victoria is a hand-gathered snapshot** (`data/states/vic.txt`), read in a real Chrome session, contracts of $5M
  and over only. It does not update itself. The refresh steps are in the README. Contact names, emails and phone
  numbers on those pages are deliberately not collected.
- **A bridge that passed rows from the Victorian site to localhost was rejected** as working around that site's
  security policy. Don't rebuild it.
- **"Late" is a stand-in.** AusTender's `dateSigned` just repeats the publish date, and grants don't publish their
  agreement date, so lateness is measured from the start date. Say so whenever the figure is quoted.
- **No tax payable is not tax avoidance.** Keep the Tax Office's caution next to any list of company names, and never
  present tax divided by total income as a tax rate.
- **Unreadable files are left out, not guessed at.** Queensland skips about 40 agency files and lists them on the page.

## Licence and funding

Today the project has no funding of any kind: the owner pays for it, there are no sponsors or paying users, no
GitHub Sponsors page, no hosted site and no public API. Planned, none of it set up: AGPLv3 for the code, publishers'
own licences (mostly CC BY) for the data, and this model for money: free public site and
non-commercial API, a paid commercial API with stored history and alerts, and a way for individuals to chip in once
the repository is public. The aim is a small business with open code, not a non-profit. Full wording is in the
README. Keep the Victorian snapshot, NSW and Tasmania out of any paid product until their licences are confirmed.

## Not verified yet

- Budget papers are listed as CC BY 4.0 from memory; the notice wasn't found on the page.
- NSW is listed as CC BY 4.0 and Tasmania as government copyright with attribution; neither was confirmed.
- NSW shows Clayton Utz at $4.6B across 14 contracts. It may be a legal panel's ceiling rather than spend.
- No figure has been spot-checked by hand against tenders.gov.au or the other publishers' own sites.
- The ABS Business Indicators series may not cover all of banking; check before quoting the finance industry figure.

## Known gaps in the data

South Australia's contracts (same blocked system as Victoria). Earnings of ASX-listed companies (no open source:
PDF announcements, commercial licensing). The Final Budget Outcome as its own document (PDF only; its figures
arrive in the next Budget's tables). WA's newest open contract file is 2023-24. Tasmania only exposes 30 days.

## Status on 30 September 2026 (midday)

- **Last night's publish ran and deployed** (04:36 to 04:47 Canberra): the Final Budget Outcome section, the Northern
  Territory on the fuel page and the IPEA links all render on the public site. But the run reports **79 saved, 3 failed**,
  and `state_grants` is **still 0 rows** with the State grants page saying no NSW snapshot has been taken. The three
  failures are most likely the three `state-grants:*` steps (that would explain both facts), possibly the state sites
  refusing a Google Cloud address, but this is unconfirmed: the session could not read the VM log. Run
  `gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap --command "sudo journalctl -u receipts-publish -n 60 --no-pager -o cat"`
  and look for the `failed` lines.
- **Cash rate missed the 30 September rise to 4.60% (+0.25).** Cause: the `cash-rate` series read RBA Table F1.1, a
  *monthly average* published on the 1st, so a decision late in a month appeared a month later and diluted; the site
  showed "4.35% Aug 2026". Fixed in `lib/sources/rba.ts`: a new daily series `cash-rate-target` (Table F1,
  `FIRMMCRTD`, one point per business day since 2016) is the headline, carried forward to today from the RBA's own
  decisions table at `rba.gov.au/statistics/cash-rate/` when a decision is in effect but not yet in the CSV (the page
  failing changes nothing). The monthly average stays stored under its old id, so no series changes format. Tested
  on 30 September: the daily table ended 29 September at 4.35 and the decisions page added 30 September at 4.60.
- **Publish freshness, reviewed at the owner's request.** What the once-a-day build misses:
  1. *Timing.* Everything is read at 04:30. The RBA posts daily tables about 09:00 and decisions at 14:30; the ABS
     releases at 11:30. So each figure is 17 to 48 hours behind its publisher by schedule alone. A second run at
     about 12:30 Canberra (after the ABS, after the RBA's morning tables) would halve that; the build took 11 minutes
     this morning, and the snapshot store is safe to run twice a day (snapshots upsert per day, observations
     de-duplicate on value). Not done: it is the owner's call on VM load; it needs a second timer and a flag on
     `publish.sh` to skip the backup on the midday run.
  2. *Stale cache.* Next keeps `.next/cache/fetch-cache` between builds and honours each loader's `revalidate` there.
     Nine loaders use 24 hours (Budget, Treasury, states, state grants, companies, TVFY, asset sales, migration,
     crime), and with `RandomizedDelaySec=10m` two runs can be under 24 hours apart, so a day-old file was reused on
     some days. `deploy/publish.sh` now deletes that directory before the build. Live at the next pull.
  3. *No "built at" on the pages.* Only `/sources` says when the last snapshot ran. A footer line would let a reader
     see the age of what they are looking at. Not done.

## Start here tomorrow (written 29 September 2026, evening)

Everything below this list is detail; this is the order to work in.

1. **Check last night's publish.** It failed on 28 September (disk full) and the disk was resized on 29 September, so the
   29 September run at 04:32 Canberra time is the first with room. `.deployackfill-status.ps1` shows disk and
   database; `gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap --command "sudo journalctl -u receipts-publish -n 20 --no-pager -o cat"`
   shows the run. Then open the public site and check three new things rendered: the Budget page's "what the year
   actually cost, against the plan" section (Final Budget Outcome), the Northern Territory on the fuel page (region
   averages), and the Expenses page links to IPEA (they were 404 until 28 September). Also that `state_grants` is no
   longer empty (it was 0 rows on the VM because the publish that fills it had failed).
2. **Three housekeeping decisions on the VM**, none urgent, all noted in `docs/backfill.md`: delete the stale 1.7 GB
   `data/receipts-backup.db` (the bucket holds the dated copies); set a 14-day lifecycle rule on the backup bucket now
   that each nightly copy is 6.5 GB; decide whether to drop the `release` JSON column from `contract_releases` to
   roughly halve the database (every field already has its own column; needs a VACUUM with free space equal to the file,
   which the 30 GB disk now has).
3. **Pick the next build** from the sections below, in this order of value: donations (one AEC download, every column,
   an afternoon), the taxing Acts (one API walk), the two "spending too high" scorecard rules (data already stored),
   bills (an id walk of about 2,600 pages), Victorian grant awards from annual reports (route proven, incomplete by
   construction), the actual-expenditure sources (Finance monthly statements, Transparency Portal).
4. **Owed from the AusTender audit**, still open: switch the live 90-day query to `contractLastModified` (the
   Contracts page undercounts amendments about eighty to one), fix the notice-page parser's four missing labels and
   re-read the 3,677 damaged pages, keep the ATM and SON GUIDs, read all 32 grant columns.
5. **Loose ends**: the 2022-23 Final Budget Outcome file is not at the standard path (find it and add the year); the
   Victorian fuel key is still pending with the scheme; the dev server must be started by hand when needed (it was
   stopped twice by the machine running low on memory, and I no longer start it on my own).

## Done since 25 September (status on 29 September 2026)

- **Backfill finished (29 September, 00:29 Canberra).** Every unit: contracts 2007-08 to 2025-26 (1,158,436 release
  rows, 860,023 contracts), grants 2017-18 to 2025-26 (351,770), IPEA (605,918 lines), APS, companies, Budgets, GFS,
  series depth. The database is 6.5 GB and passed a full `PRAGMA integrity_check` ("ok", 49 minutes on the VM).
- **Disk resized 20 GB to 30 GB (29 September)** after the backfill filled it and the 28 September publish failed with
  "database or disk is full". The build, npm and apt caches were deleted first (regenerated automatically), then
  `gcloud compute disks resize`, `growpart` (from `cloud-guest-utils`, which the image lacked) and `resize2fs`.
  13 GB free after.

- **Backfill loop unstuck (28 September).** It had retried one week for three days. Cause: AusTender re-stamped every
  record's last-modified date onto 27 and 28 April 2023, so `contractLastModified` has nothing before then and those
  two days hold everything. Fix in `lib/sources/austender.ts` and `lib/db/backfill.ts`: empty windows read as empty,
  oversized windows split or skipped with a note, windows before 29 April 2023 read from `contractPublished`. The VM
  is on FY2022-23 and moving; 2023-24 to 2025-26 done (about 350,000 release rows). Details in `docs/backfill.md`.
- **Expenses page links fixed (28 September).** IPEA rebuilt its site; links are now name-slug pages with a period id
  (`lib/sources/ipea.ts`, `reportUrl`). Live at the next publish.
- **Fuel keys: Queensland and South Australia live (28 September).** Both in `.env.local` and on the VM under the
  loaders' names `FUEL_QLD_KEY` and `FUEL_SA_KEY` (the owner's own names `QLD_FUEL_API`, `SA_FUEL_API` are kept
  alongside). Keys checked with one raw call each. Victoria still pending.
- **Scorecard: Response group (25 September).** Five rules on whether planned spending grows at least as fast as the
  pressure it answers; 4 of 5 met on the first reading (`docs/kpi-scorecard.md`).
- **Public repository history rewritten (25 September).** The owner's email and cloud resource names were removed from
  every commit and the force-push done; the VM's clone was repointed on 28 September. Never put account names or
  resource ids in tracked files again; they live in the git-ignored `docs/HANDOVER-launch.md`.
- **Actual expenditure sources tested** (`docs/actual-expenditure-sources.md`): Finance monthly statements and the
  Transparency Portal data API. Not built yet.
- **"Connect all this" pass over the not-connected list (29 September).** Every entry re-tested with a browser-style
  request. Two connected: the **Final Budget Outcome** (`lib/sources/fbo.ts`: Treasury's Part 1 Word file parses
  cleanly; expenses by function, receipts by head and net capital investment, estimate beside outcome, 2019-20
  onward; a section on the Budget page, an `fbo` snapshot step, series `fbo-fn:*` and `fbo-receipt:*`) and
  **NT fuel** (`lib/sources/fuel/nt.ts`: MyFuel NT's public JSON endpoint gives average prices per region, so the
  Territory is a seventh fuel state at region level, no station rows). The rest stay off, each for a reason that
  doesn't change: South Australia (contracts and every grants site), Tasmania and the NT grants directory sit
  behind a real Cloudflare "Just a moment" challenge, which is a bot check this project will not automate past;
  ASX earnings are licensed; Victorian, WA, ACT and NT grant awards have no register (WA's data catalogue has 326
  "grants" datasets, none a list of recipients); the ACT has no fuel scheme. If a browser ever has to be involved
  for a snapshot (SA contracts, like Victoria's), that is a hand step, not a nightly job.

## For tomorrow: three kinds of history the backfill can't fetch yet (written 25 September 2026)

The backfill loop on the VM now fetches old records for seven kinds of data (see `lib/scorecard.ts` note above and
`docs/backfill.md`). Three kinds are still missing, each for a different reason. Nothing else is waiting on them;
the loop runs the rest and finishes on its own.

1. **Who voted for what in Parliament.** The site shows this but never saves it. Keeping the history means new
   storage (one table of divisions since 2006, one of each member's vote) and code to fetch it year by year from
   They Vote For You. That data is third-party under a CC BY-SA licence that may not allow it in a paid product.
   **Decision needed:** is that licence acceptable? If yes, build it; if not, leave the page reading live.
2. **State government contracts.** The site only shows each state's recent contracts and saves none of them. Getting
   the history means a `state_contracts` table and separate fetching code for NSW, the ACT, the NT, WA and Queensland,
   because each publishes differently (the NT gives every award since 2012 in one file; NSW and the ACT take date
   ranges; WA has one file per financial year; Queensland's agency files are patchy). Tasmania and Victoria publish
   no history. **Suggested first**, as the biggest hole in the spending record.
3. **Petrol prices.** Recorded only since September 2026. Old prices exist as monthly files (NSW since 2016,
   Queensland since 2018, WA since 2001), each state's in its own layout, so one parser per state and hundreds of
   small units. Lowest value of the three; do last, if at all.

## For tomorrow: actual expenditure, and what the AusTender audit found (written 25 September 2026)

AusTender values are ceilings, not spend; Finance says so in RMG-423. Two sources publish what was actually paid,
both tested by script today, both free of logins and keys. Details, the API call and the table names are in
`docs/actual-expenditure-sources.md`.

1. **Finance monthly financial statements.** One HTML page a month with actual, year-to-date, Budget profile and
   full-year estimate for every line of the operating statement. Latest: May 2026. **Suggested first**: one parser,
   one page a day, and the Budget page gets "spent so far against plan".
2. **Transparency Portal annual-report tables.** A public POST API returns, per entity and year, actual dollars paid
   on consultancy and non-consultancy contracts and the organisations paid, with ABNs. Never fetch it unfiltered
   (60 MB, the server cuts it off). Joined by ABN to `contract_releases` and `companies` this gives commitment
   versus payment per supplier and agency. **Check the portal's licence first.**
3. **From the audit** (`docs/query-audit.md`): the live 90-day query still reads `contractPublished` and so
   undercounts amendments about eighty to one; switch it to `contractLastModified`. The notice-page parser needs
   the four missing labels ("Limited Tender Condition", "Original", "Amendments", "Supplier Details") and should keep
   the ATM and SON GUIDs, then re-read the 3,677 damaged pages. Grants read 14 of 32 report columns.
4. **Reading rules to keep in mind** (README, "Things to know about the AusTender data"): the first value is the
   initial term only, an amendment restates the whole total, and "active" never means running.
5. **Say it on the page.** Worked example from 25 September 2026: the 50 Marcus Clarke St leases (CN4265574, CN4265580)
   read as one lease renewed at 14 times the price with two landlords paid at once. They are two consecutive leases,
   the 2010 one first reported on 31 July 2026 (sixteen years late; the site's own search finds no earlier notice, only
   the 2009 fitout contract with the same ABN), each amended the same day from initial-term to whole-of-term value.
   Add plain-words flags next to a row: "amended on the day it was published", "published N years after it
   started", "period ended on <date>". The Revisions page should say an amendment restates the total.
6. **The API has nothing before 2013.** `findById/CN188534` (published May 2009) returns no releases. The backfill plan
   says notices go back to 2007; before 2013 they exist only as site pages, so the pre-2013 units need the page route.
7. **Senate Order lists: each agency's own statement of its current contracts.** AusTender publishes them twice a
   year (financial and calendar year) at `/senateorder/list`, one spreadsheet per agency at
   `/SenateOrder/Download?AgencyId=<guid>` (the guid is in the list page's links; DEWR's is
   `9327e6fc-1f61-4556-8fb6-7d0a3c651b33`, the same id as its OCDS party id). Every contract of $100,000 or more
   active in the period, with CN id, supplier, ABN, description, category, confidentiality flags, publish, start and
   end dates (Excel serials) and value; a statistics block on top. Tested 25 September 2026: DEWR 2025-26 has 1,133
   rows, and it settled the Marcus Clarke question (only the 2021 lease is listed as current). Worth a table,
   `senate_order_contracts`, keyed by agency, period and CN id: it is the only per-agency "current" view AusTender
   gives, and joins straight to `contract_releases`.
8. **The site search reaches what the API can't.** `/Search/KeywordSearch?keyword=<quoted phrase>&Page=N` returns
   15 records a page across ATMs, CNs and SONs back to 2007, with each record's GUID link, and the CN pages from 2009
   read with the existing parser. That is the route for pre-2013 notices (item 6) and for "every notice mentioning
   this address or supplier". The advanced CN search form (`/cn/search`, fields Keyword, SupplierName, SupplierAbn,
   dateType, dateStart, dateEnd, ValueFrom, ValueTo) did not return results to a plain GET; work out its parameters
   before relying on it.

## For tomorrow: two "is spending too high" rules for the scorecard (written 25 September 2026)

The owner asked whether spending that is unnecessary or too high can be measured. It can't be judged from the
records, and the site must not pretend to; what can be measured is a line item against a fixed yardstick, the
same way every other scorecard rule works. Two rules agreed in principle, data already stored, tone neutral
(no side, no adjectives), to go in a new group, working name "Restraint":

1. **Parliamentary travel not rising faster than prices.** From `ipea_expenses` (192,000 lines, quarterly,
   parliamentarians and their staff). Travel-related = `high_level_category` in Employee Travel, Scheduled
   Commercial Transport, Unscheduled Commercial Transport, Travel Allowance, Other Car Costs, International Travel,
   Family or Nominee Travel. Rule: the latest four quarters against the four before, compared with CPI growth over
   the same period. Readings on 25 September 2026: travel $60M in 2023-24, $61M in 2024-25, $68M in 2025-26
   (about +11%, above CPI, so the rule is missed today); all expenses $170M, $175M, $175M (flat). The latest
   quarter, April to June 2026, is the largest on record at $50M. Quarters are lumpy (sitting weeks, elections), so
   always compare four quarters, never one. Store the quarterly totals as series (`ipea:travel`, `ipea:total`) in
   the snapshot so the rule reads them like any other. IPEA does not cover public servants' travel; departments
   disclose that only in Senate estimates answers, and there is no dataset. Say so on the page.
2. **Total spending not above its long-run share of GDP.** Payments as a share of GDP (`budget-payments` and the
   GDP series are stored; the Budget tables also give the share directly) against the 30-year average. The
   scorecard already has real payments growth against the 2% ceiling and the tax take; this is the level test that
   goes with them. Yardstick basis: no government has published a spending ceiling since 2022.

Also measurable later, each with a source, if wanted: contract value added by amendment per agency and category
(from `contract_releases`, now stored); limited tender under a stated exemption versus none (exemption codes now
stored); non-competitive and ad hoc grants share (already in the grants summary); campaign advertising from
Finance's annual report; and consultancy and contractor spend against APS headcount from the Transparency Portal
and the APSC, where the government's own 2023 commissioning framework gives a published basis. Present any of
these as line items against a yardstick, never as a verdict on necessity.

## For tomorrow: three new feeds, decided and sourced (written 29 September 2026)

The owner asked for bills, political donations and a list of taxes. Each was probed by script on 28 and 29
September 2026 and the owner chose the reading below. Nothing is built yet; every source below is public, keyless,
and returns to a plain request (Parliament's sites need a browser-style user agent: the project's `USER_AGENT`
gets HTTP 403, a Chrome-style string gets 200). Per the project rule, each gets a per-record table with every field.

1. **Bills: every bill since 2013 with its fate.** Two sources that join:
   - **ParlInfo bill home pages**, `https://parlinfo.aph.gov.au/parlInfo/search/display/display.w3p;query=Id%3A%22legislation%2Fbillhome%2Fr7473%22`,
     one per bill, ids `rNNNN` in introduction order (r7548 was the newest on 28 September 2026). The page text has,
     in order: title; Type (Government or Private); Originating house; Status (Act, Before Senate, Lapsed, Negatived
     ...); Portfolio (or Sponsor for a private bill); Summary; then "Progress of bill" with a dated stage list per
     house (Introduced and read a first time, Second reading moved, Second reading debate, Second reading agreed to,
     Third reading agreed to), "Finally passed both Houses", "Assent", "Act no:" and "Year:". Dates are dd/mm/yy.
     Parse it the way `parseNotice` parses AusTender pages: strip tags, walk labels. The RSS feeds
     (`/parlInfo/feeds/rss.w3p;query=Dataset:billsCurBef` and `billsCurNotBef`, `;resCount=100`) list current-
     parliament bills but cap at 500 items and give only title, link and date, so use them for "new bills today" and
     walk the ids for history. **Still to find:** the id where 2013 starts (probe r4900 to r5500 and read the year in
     the title); the id walk is about 2,600 pages at a polite pace, an hour or so, a backfill unit like the notices.
   - **Federal Register of Legislation API** (OData, no key): `https://api.prod.legislation.gov.au/v1/titles` with
     `$filter`, `$count=true`, `$top`/`$skip`, `$apply=groupby(...)`. 13,741 Acts. Each title carries id
     (`C2026A00024`), name, makingDate, status (InForce, Repealed ...), isPrincipal, year, number, statusHistory,
     nameHistory and `originatingBillUri`, the ParlInfo bill page it came from. That is the join from a bill to the
     Act it became. `$expand=*` errors; select fields explicitly. Entity sets also include Departments, Versions,
     Affect (which Acts amend which).
   - Table `bills` keyed by ParlInfo id: every field above plus the Act id when the register has it. Page: counts by
     year, portfolio and type; time from introduction to assent; private members' bills and how many became law;
     bills before Parliament now. Nav: under Parliament as `/bills`.
2. **Political donations: who gave what to whom, by year.** AEC Transparency Register export,
   `https://transparency.aec.gov.au/Download/AllAnnualData`, a 2.6 MB zip of 13 CSVs, no login, plus
   `AllElectionsData` and `AllReferendumData` for later. Files and columns (financial years 1998-99 to 2024-25;
   the year label changes format, "1998-1999" then "2011-12", so normalise):
   - Donations Made (66,278 rows): Financial Year, Donor Name, Donation Made To, Date, Value. Donor-declared.
   - Detailed Receipts (124,288 rows): Financial Year, Return Type (Political Party, Associated Entity, Significant
     Third Party, Political Campaigner, Member of HOR), Recipient Name, Received From, Receipt Type (Donation Received,
     Other Receipt, Subscription, Public Funding, Unspecified), Value. Recipient-declared. 2024-25 "Donation Received"
     rows: 2,559, $165M.
   - Party Returns (2,229): Financial Year, Name, Party Group, Total Receipts, Total Payments, Total Debts, Total
     Discretionary Benefits. Also Donor Returns, Associated Entity Returns, Significant Third Party Returns (with ABN
     and ACN), Third Party Returns, Detailed Debts, Discretionary Benefits, Capital Contributions, MP returns.
   - Tables: one per CSV, every column, keyed by file, year and row number, replaced whole on each download (the
     export is the whole register; returns are amended). First page: donors to each party by year from both sides
     (what donors declared giving, what parties declared receiving; they differ, say so), largest donors, party
     totals. State the disclosure threshold on the page: gifts under it are not in the data. Nav: under Parliament
     as `/donations`. Owner declined the name-match to suppliers for now; AEC gives ABNs only for third parties.
3. **The list of taxes: every Act that imposes a tax, from the Register of Legislation.** The API has no subject
   field, so the list is a name rule, printed on the page: in-force Acts whose name contains Tax, Excise, Levy,
   Customs Tariff, Duty, Charge or Imposition (counts on 28 September 2026: Tax 484, Excise 98, Levy 169, Customs 212,
   Charge 183, Imposition 97, Duty 6; overlapping). Refine by hand once listed: the constitutional test (s 55) is that
   an Act imposing taxation deals only with imposition, which is why so many are "... Imposition Act"; amending and
   assessment Acts should be shown apart from imposing Acts. Table `taxing_acts` with every API field plus the rule
   that selected it; page: the list by kind, year made, in force or repealed, with the count over time. Nav: under
   Money as `/taxes`. Later, join to Budget Paper 1 revenue heads for the dollars each raises.

Order: donations first (one download, every column, one afternoon), then the taxing Acts (one API walk), then bills
(the id walk is the long part). Add each to `/sources` and to the snapshot, and log the start in `docs/backfill.md`.

## For tomorrow: state grant awards from annual reports, a proven route (written 29 September 2026)

The states publish no register of grant awards, but their departments' annual reports do list recipients, and
Victoria's are published as accessible Word files whose tables parse with the same code as the Final Budget Outcome
(`docxTables` in `lib/sources/fbo.ts`). Tested on the Department of Families, Fairness and Housing 2024-25 report:

- Landing page `https://www.dffh.vic.gov.au/publications/annual-report` lists one Word and one PDF link per year,
  2020-21 to 2024-25 (`/dffh-annual-report-<year>-accessible-version-word`; the link redirects straight to the file).
- Appendix 3 "Grants and transfer payments": eight tables, one per departmental output (Community Participation,
  Disability Services, Housing Support and Homelessness Assistance, LGBTIQA+ equality, Primary Prevention of Family
  Violence, Support to Veterans, Women's policy, Youth), each headed "Organisation | Payment ($)" with a "Total" row
  to drop. 2024-25: 718 recipient rows, about $97M, every row with an amount. The table caption is the output name,
  which is the only grouping the report gives; there is no program, date or ABN.
- Reachable without a bot check: DFFH, Education, Health, Justice, Transport and Planning, Government Services,
  Treasury and Finance, Premier and Cabinet. **Behind a Cloudflare challenge: DJSIR (jobs, regions, industry) and
  DEECA (environment, energy, water)**, which are two of the largest grant-givers, so a Victorian set from this route
  is incomplete by construction and must say so on the page.
- Each department's report has to be found and its grants appendix identified by hand once (heading and table
  shape vary); after that, one download per department per year. WA, the ACT, Tasmania and SA departments publish
  annual reports too (SA and Tasmania behind the bot check, so PDF by hand), each with its own layout.

Build shape when wanted: `lib/sources/state-grants/vic-annual-reports.ts` with a fixed list of (department,
year, file URL, appendix heading), rows into `state_grants` with `program` = output, `source_url` = the report,
and a coverage line naming the departments included and the two that could not be read. Hand-gathered means
hand-gathered: label it a partial record, not the state's total.

## What to do next, in order

1. ~~Put it in git~~ Done: https://github.com/MrAnderson-bot/receipts, AGPLv3.
2. ~~Create the VM and the Pages project~~ Done (hosting plan above). Remaining: put a Cloudflare API token
   (Cloudflare Pages: Edit, on the personal account) and the account id `2779902e70532b99496bfced7aa61ebf` into
   `/etc/receipts.env` on the VM, then `sudo systemctl start receipts-publish.service` and check the log. Until
   then, `npm run snapshot` on the dev machine keeps history accumulating.
   **Fuel API keys to register**, also for `/etc/receipts.env`, each on the personal account, never a company one.
   Status 28 September 2026: NSW/TAS, Queensland live feed and South Australia keys in place and on the VM. Victoria
   is still applied for; the scheme approves by hand and emails the key. Nothing to do in code until it arrives: the
   loader and page text are ready, and Victoria says "waiting on a key".
   Every keyed scheme is read at most three times a day (eight-hour cache, and a failure waits eight hours too).
   The pages cache only the state summaries; the station rows are over Next's 2 MB cache limit, so the snapshot
   step loads each feed once more, uncached, and stores the rows itself (the same pattern as `loadAps`):
   - NSW FuelCheck v2 (`FUELCHECK_NSW_KEY`, `FUELCHECK_NSW_SECRET`) at https://api.nsw.gov.au/Product/Index/22.
     Also covers Tasmania: one request with `states=NSW|TAS` (without that parameter the API returns NSW only).
     2 calls a load (token, then all prices); the nightly build loads it at most twice (page render and
     snapshot), so about 4 a day, 120 a month against a free tier of 2,500.
   - Queensland live API (`FUEL_QLD_KEY`) at https://www.fuelpricesqld.com.au/. About 4 or 5 calls a day (prices
     three times, stations once, reference lists weekly). Without it the monthly file on data.qld.gov.au is used,
     two requests a day, no key.
   - South Australia (`FUEL_SA_KEY`) at https://www.safuelpricinginformation.com.au/publishers.html. Same API
     as Queensland's live feed, about 4 or 5 calls a day.
   - Victoria's Servo Saver (`FUEL_VIC_CONSUMER_ID`, and the endpoint URL from the approval email as
     `FUEL_VIC_URL`) at https://service.vic.gov.au/find-services/transport-and-driving/servo-saver/help-centre/servo-saver-public-api.
     1 call a load, at most 3 a day. The response layout is unconfirmed until the first live run.
   WA FuelWatch needs nothing (5 RSS requests once a day, one per fuel; the unfiltered feed is statewide). The NT has no feed and the ACT has no scheme. Until a
   key is in place the fuel page and the sources page say so for that state, in those words.
3. **Per-record tables, matching the government's records one-to-one.** Done for contracts on 22 September 2026:
   the `contracts` table holds one row per notice from the API, and the nightly job then reads each notice's public
   page for the fields the API leaves out (execution date, extension options, max end date, ATM ID, "Australian
   business engaged", "New Zealand business engaged", suppliers invited, confidentiality flags and reasons,
   consultancy, agency reference ID, supplier town/state/country/ABN), storing the parsed fields in `n_*` columns and
   the whole notice as JSON. The page id is the hex tail of the API's award id as a GUID
   (`tenders.gov.au/Cn/Show/<guid>`); the contract number itself does not work. Reading is polite: two pages at a
   time, 400 ms apart, at most `NOTICE_BUDGET` (default 1,500) per run, newest first, so the backlog of a 90-day
   window (about 16,000) clears in under two weeks and a normal day's 150-200 new notices take a minute. Agency
   contact names, phones and emails on the page are deliberately not read. The Contracts page lists notices whose
   fields contradict each other ("Yes" to Australian business with an overseas address or no ABN): in the 90 days to
   22 September 2026 there were 108, $182M, of which 65 with an overseas address, $139M, Cowater's $110M the largest.
   Still to do: the same for **grants**, then the **ABN cross-link**: join `companies` to suppliers and grant
   recipients by ABN to answer "which companies with no tax payable hold government contracts, and for how much".
4. **Read history back into the pages**: revision markers on the economy charts, and "this figure a month ago" on
   contracts and grants, from `seriesHistory()` and `snapshots()`.
5. **Fill the indicator gaps**, all available without keys. Done 25 September 2026 with the scorecard: mean home
   price, household debt to income, new mortgage rate, participation, underemployment, productivity, a real-wages
   line, public investment and nominal GDP (for shares of GDP). Still to do: housing lending (ABS `LEND_HOUSING`),
   trade and the RBA commodity price index, hours worked and job vacancies.
   **Scorecard follow-ups** (`docs/kpi-scorecard.md` has the full list): store each day's scorecard result as a
   `scorecard` snapshot so "indicators met" can be charted; store the 90-day contract summary's late and limited
   tender figures as daily series so the two procurement rules can switch from fixed thresholds to "no worse than
   a year earlier" in September 2027; then emissions against the 43% target (DCCEEW), R&D share of GDP, SME share
   of contracts (Finance's yearly procurement statistics), bulk-billing, and state budgets (ABS GFS).
6. **More sources**: ASIC insolvencies, ABS Government Finance Statistics for state budgets and debt, AEC political (now planned above, 29 September)
   donations (joinable to contracts by name), DSS payment recipients, net overseas migration.
7. ~~**They Vote For You**~~ Done 25 September 2026: `lib/sources/tvfy.ts` and `/parliament`, labelled third-party on
   `/sources`. Still to do: put the key on the VM as `TVFY_API_KEY` in `/etc/receipts.env` (the site builds without it
   and says so on the page), and confirm the CC BY-SA licence before the data goes in any paid product.
8. **Forecasts to model against**: the RBA's quarterly forecast tables, and the Budget's economic parameters, which
   are already inside the data.gov.au zip that `budget.ts` downloads.
9. **Then the prediction engine**, starting with a plain, documented model over the stored series.
10. Move the database to Supabase when the site is deployed (steps above).
