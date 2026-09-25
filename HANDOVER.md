# Receipts: handover

Last updated 22 September 2026. For how each data source works and its quirks, see `README.md`. This file covers
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

`npm run snapshot` is a static export (`STATIC_EXPORT=1 SNAPSHOT=1 next build`). The snapshot runs inside the
build, in `app/api/snapshot/route.ts`, because the source loaders use Next's cache and can't run outside a Next
process. Stop the dev server before running it; both use `.next`.

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
| `/budget` | Budget balance, expenses by function, net debt, largest programs |
| `/companies` | Tax Office transparency list (about 4,100 large companies), company profits by industry |
| `/spending` | Commonwealth contracts: late reporting, limited tender, agencies, suppliers (nav label "Contracts"). `/spending/7`, `/spending/90` for other ranges |
| `/categories` | What contracts buy, by UNSPSC segment (same `/7`, `/90` ranges) |
| `/grants` | Commonwealth grant awards (same ranges) |
| `/expenses` | Parliamentarians' work expenses, latest quarter vs a year earlier (IPEA): categories, parties, states, top 20 people, largest lines. Every line stored in `ipea_expenses` |
| `/states` | NSW, VIC, QLD, WA, NT, TAS contracts and ACT invoices. `/states/QLD` etc. |
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
- **Live since 22 September 2026**, all under the owner's personal accounts (a personal Google account), never the
  company's, and everything in Sydney:
  - Public site: https://receipts-byv.pages.dev (Cloudflare Pages project `receipts`, classic Pages, created with
    `--force` because wrangler otherwise tries to convert a Next.js app to its Workers adapter and edits the repo;
    if that ever happens again, revert `next.config.mjs`, `package.json` and delete `wrangler.jsonc`,
    `open-next.config.ts`, `public/_headers`, `.dev.vars`).
  - Google Cloud project the project, VM `receipts-engine` (e2-micro, `australia-southeast1-b`, Debian 12,
    about AUD 10-12 a month), bucket `the backup bucket`. The default SSH/RDP/ICMP firewall rules are
    deleted; SSH only through IAP: `gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap`.
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

## What to do next, in order

1. ~~Put it in git~~ Done: https://github.com/MrAnderson-bot/receipts, AGPLv3.
2. ~~Create the VM and the Pages project~~ Done (hosting plan above). Remaining: put a Cloudflare API token
   (Cloudflare Pages: Edit, on the personal account) and the account id `2779902e70532b99496bfced7aa61ebf` into
   `/etc/receipts.env` on the VM, then `sudo systemctl start receipts-publish.service` and check the log. Until
   then, `npm run snapshot` on the dev machine keeps history accumulating.
   **Fuel API keys to register**, also for `/etc/receipts.env`, each on the personal account, never a company one.
   Status 25 September 2026: NSW/TAS key in place and working. Victoria, South Australia and the Queensland live
   feed are applied for; each scheme approves by hand and emails the key, so the owner is waiting on them. Nothing
   to do in code until a key arrives: the loaders and page text are ready, and each state says "waiting on a key".
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
6. **More sources**: ASIC insolvencies, ABS Government Finance Statistics for state budgets and debt, AEC political
   donations (joinable to contracts by name), DSS payment recipients, net overseas migration.
7. ~~**They Vote For You**~~ Done 25 September 2026: `lib/sources/tvfy.ts` and `/parliament`, labelled third-party on
   `/sources`. Still to do: put the key on the VM as `TVFY_API_KEY` in `/etc/receipts.env` (the site builds without it
   and says so on the page), and confirm the CC BY-SA licence before the data goes in any paid product.
8. **Forecasts to model against**: the RBA's quarterly forecast tables, and the Budget's economic parameters, which
   are already inside the data.gov.au zip that `budget.ts` downloads.
9. **Then the prediction engine**, starting with a plain, documented model over the stored series.
10. Move the database to Supabase when the site is deployed (steps above).
