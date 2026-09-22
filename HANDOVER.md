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
| `/economy` | 12 ABS and RBA indicators with history |
| `/revenue` | Commonwealth receipts by source, share of GDP, taxes by level of government |
| `/budget` | Budget balance, expenses by function, net debt, largest programs |
| `/companies` | Tax Office transparency list (about 4,100 large companies), company profits by industry |
| `/spending` | Commonwealth contracts: late reporting, limited tender, agencies, suppliers (nav label "Contracts"). `/spending/7`, `/spending/90` for other ranges |
| `/categories` | What contracts buy, by UNSPSC segment (same `/7`, `/90` ranges) |
| `/grants` | Commonwealth grant awards (same ranges) |
| `/states` | NSW, VIC, QLD, WA, NT, TAS contracts and ACT invoices. `/states/QLD` etc. |
| `/sources` | Every feed with live status, database totals, and what isn't connected |

## How the code is laid out

- `lib/sources/*.ts`: one module per source. Each exports a `tryGet...()` that returns `{ data, error }` and never
  throws, so one dead source can't blank a page. States live in `lib/sources/states/` and share `StateSummary`.
- `lib/economy.ts`: which indicators exist and how they are grouped. Add one by adding an entry to `ABS_SERIES` or
  `RBA_SERIES` and its id to a group.
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
- **Not done: the VM and the Pages project don't exist yet.** Both need the owner's personal accounts
  (a personal Google account); the `gcloud` and `wrangler` logins on the dev machine were the company account, and
  nothing was created under it. Steps, once logged in as the personal account:
  1. Cloudflare: `npx wrangler pages project create receipts --production-branch main`, then a first deploy from
     the dev machine, `npx wrangler pages deploy out --project-name receipts --branch main`. Make an API token
     (Cloudflare Pages: Edit) for the VM.
  2. Google Cloud: new project, billing attached, `gcloud compute instances create receipts-engine
     --zone us-west1-b --machine-type e2-micro --image-family debian-12 --image-project debian-cloud
     --boot-disk-size 20GB --scopes storage-rw`. e2-micro in a US region is inside the free tier; the sources are all
     public HTTP so the region doesn't matter. Remove the default SSH-from-anywhere firewall rule and use
     `gcloud compute ssh --tunnel-through-iap` instead, so nothing is reachable from the internet.
  3. On the VM: `sudo bash vm-setup.sh https://github.com/MrAnderson-bot/receipts.git`, fill in
     `/etc/receipts.env`, run the service once, check `journalctl -u receipts-publish`.
  4. Optional: a Cloud Storage bucket for `BACKUP_BUCKET`, and a custom domain on the Pages project.
- Every page carries an "Under development" banner (`components/DevBanner.tsx`) listing what has been collected and
  saying it may be incomplete. Keep it until the figures have been spot-checked.
- Migration data comes from the AID project (`Projects\AID`, repo `REKT369/AID`): port its readers in as source
  modules here rather than merging the apps. Reading notes for the engine are in `docs/prediction-engine-reading.md`.

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
2. **Create the VM and the Pages project** (hosting plan above). Until the VM runs, every day without a snapshot
   is history lost; `npm run snapshot` on the dev machine fills the gap.
3. **Per-record tables, matching the government's records one-to-one.** Add `contracts` and `grants` tables holding
   every field the publisher shows for a record, not the trimmed summary shape in `lib/sources/austender.ts`. For
   AusTender that means everything on a tenders.gov.au contract notice page: execution date, extension options and
   max end date, ATM ID, "Australian business engaged", "New Zealand business engaged", suppliers invited,
   confidentiality flags and reasons, consultancy flag, agency reference ID, and the supplier's full address. The
   OCDS API carries only some of these, so record which fields are web-only and find an honest way to get them
   (a plain script fetch of a notice page returned the site shell without the record on 21 September 2026). The
   goal is that a future AI agent has the full who, what, when, where and with whom for every record. Then the
   **ABN cross-link**: join `companies` to suppliers and grant recipients by ABN to answer "which companies with no
   tax payable hold government contracts, and for how much".
4. **Read history back into the pages**: revision markers on the economy charts, and "this figure a month ago" on
   contracts and grants, from `seriesHistory()` and `snapshots()`.
5. **Fill the indicator gaps**, all available without keys: housing (dwelling values, approvals, lending, rents),
   trade and the RBA commodity price index, household debt and mortgage rates, labour detail (participation,
   underemployment, hours, vacancies), productivity, and a real-wages line.
6. **More sources**: ASIC insolvencies, ABS Government Finance Statistics for state budgets and debt, AEC political
   donations (joinable to contracts by name), DSS payment recipients, net overseas migration.
7. **They Vote For You** (parliamentary voting records). The API key is already in `.env.local` as
   `THEY_VOTE_FOR_YOU_API_KEY`; nothing reads it yet. Add it as a `lib/sources/` module like the others. Settle two
   things first: it is run by the OpenAustralia Foundation from Hansard, not a government publisher, so it is an
   exception to "official sources only" and must be labelled as third-party on `/sources`; and confirm its licence
   before it goes in any paid product.
8. **Forecasts to model against**: the RBA's quarterly forecast tables, and the Budget's economic parameters, which
   are already inside the data.gov.au zip that `budget.ts` downloads.
9. **Then the prediction engine**, starting with a plain, documented model over the stored series.
10. Move the database to Supabase when the site is deployed (steps above).
