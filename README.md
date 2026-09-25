# Receipts: the Australian economy, from the source

Live figures on the Australian economy, government revenue and spending, and large companies, pulled
from official publishers. No API keys needed.

## Run it

    npm install
    npm run dev

Open http://localhost:3000.

To store today's figures in the local database and build the public site as plain files in `out/`:

    npm run snapshot

That runs a static export (`STATIC_EXPORT=1 SNAPSHOT=1 next build`). Every page is rendered once from the live
sources, and the snapshot is saved from the same fetches. Stop the dev server first: both use `.next`.

To fill in history one financial year at a time (resumable; see `docs/backfill.md`):

    npm run backfill -- contracts:FY2025-26

Needs Node 22.5 or later. See `HANDOVER.md` for project status, the database, hosting and what to do next.

## Pages

- `/` overview: six headline indicators, Commonwealth revenue, and the last 7 days of Commonwealth contracts
- `/economy`: a recession watch (five warning signs, each with a fixed published rule) and every indicator with its history, the numbers behind each chart and a source link: recession signals (Sahm rule, yield curve, 10-year bond yield), growth, prices and rates, cost of living (rent, electricity, gas, grocery and fuel inflation, credit card debt), housing supply (dwellings approved and completed, population growth, new residents per new dwelling), jobs, pay, households and trade
- `/revenue`: Commonwealth receipts by source with Budget estimates, receipts as a share of GDP, and taxes by level of government
- `/budget`: the budget balance, expenses by function, net debt and interest, outcomes and estimates, and the 20 largest programs
- `/companies`: the Tax Office's transparency list (income, taxable income and tax payable for about 4,200 large companies, Australian and foreign-owned) and ABS company profits by industry
- `/spending`: late reporting, limited tender share and reasons, overseas suppliers, top agencies and suppliers, largest contracts (`/spending/7`, `/spending/90`; 30 days by default)
- `/categories`: what the money buys, by UNSPSC segment, split into services and goods, with the biggest buyer and seller in each
- `/grants`: Commonwealth grant awards by category, selection process, agency, recipient and state (`/grants/7`, `/grants/90`)
- `/state-grants`: state grant payments: agencies, recipients, programs, categories, assistance types, funding source, change on the year before. NSW's Grants and Funding Finder awards, Queensland's whole-of-government file and Lotterywest's approved grants for WA (`/state-grants/NSW`, `/state-grants/QLD`, `/state-grants/WA`); the other five jurisdictions are listed with why they can't be read
- `/expenses`: parliamentarians' work expenses for the latest quarter (IPEA), against the same quarter a year earlier: by category, party and state, the 20 biggest spenders with their category split, and the largest single lines, each linked to IPEA's report for that person
- `/states`: state and territory contracts (`/states/VIC`, `/states/QLD` and so on; NSW by default), plus the state with no usable data and why
- `/fuel`: fuel prices per state from each state's price reporting scheme: median and cheapest unleaded and diesel, the cheapest stations, and which schemes still need an API key
- `/migration`: net overseas migration (ABS), temporary visa holders by category, permanent Migration Program outcomes, skilled and working holiday visas granted, NOM by visa category and new citizens by former citizenship (Home Affairs)
- `/crime`: victims of recorded crime by offence since 1993 and offenders by principal offence since 2008-09, counts and rates per 100,000, Australia and each state (ABS); people homeless on Census night (ABS) and people helped by homelessness services each year, by state, with the reasons they asked (AIHW)
- `/parliament`: how every MP and senator votes (attendance and votes against their party), from They Vote For You; needs a free API key
- `/revisions`: every stored figure a publisher has changed since it was first published, and contract amendments matched to their original notice
- `/government`: size of the Australian Public Service: headcount at the latest half-yearly snapshot, change on the last one and a year ago, split by gender and classification level, the 15 largest agencies, and totals by gender back to 2006 (APSC)
- `/sources`: every feed, its licence, whether it answered, and what isn't connected yet

## Database

A local SQLite file at `data/receipts.db` keeps a daily snapshot of every feed: time series with revisions preserved,
dated summaries of contracts, grants, states and budgets, and the Tax Office's full company list keyed by ABN. It uses the
SQLite built into Node, so there is nothing to install. All access goes through the `Store` interface in `lib/db/types.ts`,
which is the seam for moving to a hosted database. Details in `HANDOVER.md`.

## Sources

One module per source in `lib/sources`, all returning the shapes in `lib/sources/types.ts`.

| Module | Source | Gives |
|---|---|---|
| `abs.ts` | ABS Data API (SDMX, CC BY 4.0) | GDP, GDP per person, CPI and its rent, electricity, gas, food and fuel components, unemployment, wages, company profits growth, household spending, saving ratio, terms of trade, population, population growth, births, dwellings approved, dwellings completed |
| `rba.ts` | RBA statistical tables (CSV) | cash rate, AUD/USD, credit card balances accruing interest |
| `../derived.ts` | worked out from the above | new residents per new dwelling (four-quarter population growth over dwellings completed) |
| `austender.ts` | AusTender OCDS API (CC BY 3.0 AU) | contract notices |
| `grantconnect.ts` | GrantConnect "Grant Award Published" report, xlsx (CC BY 3.0 AU) | grant awards |
| `ipea.ts` | IPEA quarterly expenditure extracts on data.gov.au, CSV, found through the CKAN API (CC BY 3.0 AU) | every parliamentarian expense line, latest five quarters, stored one row each in `ipea_expenses` |
| `treasury.ts` | Budget Paper No. 1, Statement 5 online tables, CSV | Commonwealth receipts by source, % of GDP |
| `budget.ts` | Department of Finance Budget tables on data.gov.au, zip of CSVs plus xlsx (CC BY 4.0) | expenses by function, receipts/payments/balance since 1970-71, net debt, program expenses |
| `states/qld.ts` | about 240 Queensland agency contract disclosure files, via the data.qld.gov.au datastore API (CC BY 4.0) | state contracts, last 12 months |
| `states/nsw.ts` | buy.nsw register of notices, contract award report (CSV from a public form) | state contracts, last 12 months |
| `states/vic.ts` | snapshot file `data/states/vic.txt`, read by hand from the Buying for Victoria register | contracts of $5M and over, not a live feed |
| `states/nt.ts` | NT tenders site export of awarded contracts (xlsx), listed on data.nt.gov.au | state contracts, last 12 months |
| `states/tas.ts` | Tasmanian tenders site, awarded list plus one page per contract (HTML) | state contracts, rolling 30 days |
| `states/act.ts` | ACT Notifiable Invoices Register on data.act.gov.au (Socrata API, CC BY 4.0) | invoices of $25,000 and over, last 12 months |
| `state-grants/qld.ts` | Queensland Treasury's consolidated grants and frontline service procurement expenditure file (QGIP), one CSV per financial year on data.qld.gov.au (CC BY 4.0) | every state grant and program payment in the latest financial year, stored one row each in `state_grants`; totals for the year before |
| `state-grants/nsw.ts` | nsw.gov.au Grants and Funding Finder: its search index for every grant, and its public GraphQL API for each grant's published awards (CC BY 4.0) | every award published on the finder since 2022: grant, agency, recipient, project, amount, decision date and maker, applicants and recipients, locations. Walked incrementally by the nightly job under a rate rule, so the page reads the nightly snapshot only |
| `state-grants/wa.ts` | Lotterywest's grant recipients page, read through the JSON endpoint the page itself uses (no open licence stated) | every grant Lotterywest approved in the last year: organisation, purpose, amount, region, approval date. Lotterywest only, not WA departments |
| `finance-sales.ts` | Department of Finance "Past sales" page (HTML, CC BY 4.0) | every Commonwealth business sold since 1988: month, proceeds, trade sale or share offer |
| `tvfy.ts` | They Vote For You API (OpenAustralia Foundation, CC BY-SA; built from Hansard, not a government publisher) | current MPs and senators, divisions attended, rebellions. Needs `TVFY_API_KEY` |
| `apsc.ts` | APS Employment Database releases on data.gov.au, xlsx (CC BY 3.0 AU) | APS headcount by agency, gender and classification per half-yearly snapshot; totals by gender since 2006 |
| `aofm.ts` | AOFM data hub, Register of Government Borrowings and portfolio executive summary, xlsx (CC BY 4.0) | Australian Government Securities on issue, face value, monthly since 2010 |
| `states/wa.ts` | Tenders WA award CSV on data.wa.gov.au (CC BY 4.0) | state contracts, latest released financial year |
| `crime.ts` | ABS Recorded Crime – Victims and Offenders publication spreadsheets, found from each release page (CC BY 4.0) | victims by offence, year and state with rates; offenders by principal offence, year and state with rates |
| `homelessness.ts` | AIHW Specialist Homelessness Services tables, found through the report's download API, and the ABS Estimating Homelessness Census table (both CC BY 4.0) | service clients per year and per 10,000 by state, reasons for seeking help; Census homeless count and rate by living situation and state |
| `fuel/wa.ts` | FuelWatch RSS feed, no key | today's price at every WA station, metro and regional |
| `fuel/qld.ts` | Queensland Fuel Price Reporting: monthly CSV on data.qld.gov.au (CC BY 4.0), or the live API with `FUEL_QLD_KEY` | each station's latest price |
| `fuel/nsw.ts` | NSW FuelCheck API v2 with `FUELCHECK_NSW_KEY` and `FUELCHECK_NSW_SECRET` | current prices in NSW and Tasmania (FuelCheck TAS) |
| `fuel/sa.ts` | SA Fuel Pricing Information Scheme API with `FUEL_SA_KEY` | current prices in SA |
| `fuel/vic.ts` | Servo Saver Public API with `FUEL_VIC_CONSUMER_ID` and `FUEL_VIC_URL` | current prices in Victoria |
| `fuel/fpdapi.ts` | the Fuel Price Data API client shared by Queensland's live feed and South Australia | |
| `ato-transparency.ts` | ATO Corporate Tax Transparency on data.gov.au, xlsx (CC BY 3.0 AU) | each large company's total income, taxable income, tax payable |
| `abs-profits.ts` | ABS Business Indicators via the Data API (CC BY 4.0) | company gross operating profits by industry, quarterly |
| `abs-tax.ts` | ABS Taxation Revenue, Australia, xlsx (CC BY 4.0) | taxes by level of government |

`lib/xlsx.ts` is a small dependency-free spreadsheet reader used by the xlsx sources.

To add an indicator, add one entry to `ABS_SERIES` or `RBA_SERIES` and put its id in a group in `lib/economy.ts`.

Not connected: South Australia. Its register is public but has no export and no open dataset, and the site sits behind a
Cloudflare browser check, so a program can't read it without pretending to be a browser. Victoria is the same, and is
covered by a snapshot instead (below).
To add a state, write a loader that returns `StateSummary` and add it to `LOADERS` in `lib/sources/states/index.ts`.

## Things to know about the Budget and state data

- Finance creates a new data.gov.au dataset for each Budget. `budget.ts` finds the newest one by title and matches
  tables by their title line, because table numbers move between Budgets.
- There is no data file for the Final Budget Outcome itself (PDF and Word only). Its figures arrive in the next
  Budget's historical tables, where past years are final outcomes and `(e)` marks estimates.
- Program expenses can't be summed to total expenses: transfers between agencies are counted by both.
- Queensland has no central feed. Agencies retype the template, so `qld.ts` matches headings loosely, accepts
  Excel serial dates, and tries a one or two column shift when values sit left of their headings. A file is only
  used if at least 70% of sampled rows parse; the rest are listed on the page as left out, never guessed at.
- Victoria is a snapshot, not a feed. The register only opens in a real browser, so `data/states/vic.txt` was gathered
  by reading the register in Chrome: the search filtered to contracts of $5M and over starting in the last 12 months
  (`/contract/search?startDateFrom=dd/mm/yyyy&minCost=5000000&orderBy=startDate`; leave out `preset` or the filters are
  ignored, and don't use `awardedDateFrom`, which means "added or updated since" and returns contracts from 2017),
  then each contract page for public body, type, UNSPSC, supplier and ABN. Contact names, emails and phone
  numbers on those pages are deliberately not collected. Cloudflare's own crawler can't do this: it identifies itself
  as a bot and is challenged like any other. Refresh the file the same way when the figures need updating.
- NSW: POST the report form with `noticeType=can`, a date range and `export=1` (the submit button's value; without it
  you get the page back). buy.nsw has an AWS bot check that answers 202 with an empty body after a burst of requests.
  One request a day passes; failures back off for 20 minutes instead of retrying on every page view.
- NT: `/Tender/ExportTenderers?status=Awarded&awardedDateFrom=YYYY-MM-DD`. Without the ISO date the server rebuilds
  the register back to 2012 and takes two minutes; dd/mm/yyyy is silently ignored.
- Tasmania publishes only the last 30 days and no values on the list, so each contract page is read (about 40 a day,
  three at a time).
- The ACT figures are payments, not contract awards. Its live contracts register is behind the same browser check as
  Victoria and SA. Agency names are the ACT's own abbreviations.
- WA's newest open file is 2023-24. Panel contracts repeat the full value per supplier and are counted once.
- State figures are not comparable with each other or with AusTender: thresholds, periods and value definitions differ.

## Things to know about GrantConnect

- There is no API, but the site's own report at `/Reports/GaPublishedDownload` returns a spreadsheet for a
  plain GET with a date range, no login. It is capped at 50,000 rows per request (90 days is about 5,000).
- The site returns 403 to clients without a browser-style user agent. `USER_AGENT` in `lib/xlsx.ts` names
  this project using the `Mozilla/5.0 (compatible; ...)` convention crawlers use. Keep it honest.
- The download is slow (10 to 20 seconds), so the parsed summary is cached for six hours.
- One-off/ad hoc grants have a blank selection process. "Late" is measured from the grant start date,
  a stand-in for the day the agreement took effect.

## Things to know about state grants

- Only Queensland publishes a whole-of-government list of grant payments. Treasury collects every department's
  lines each year and posts one consolidated CSV per financial year (2012-13 onward) on data.qld.gov.au. The
  loader takes the newest year in full and the year before for its totals.
- NSW has no file either, but its Grants and Funding Finder is a register: the Grants Administration Guide makes
  agencies publish each award on the grant's finder page within 45 days, and those awards sit behind the site's
  public GraphQL endpoint (`POST /graphql`, the finder's own queries copied from its `grant-recipients` script).
  The site sits behind a CloudFront rate rule: three readers at once were blocked outright after five minutes
  (a 403 on everything for a while), one reader at a request or two a second never was. So NSW is walked
  incrementally by the nightly job, never by a page. Each night: list every grant from the finder's search index
  (`/api/v1/elasticsearch/prod_content/_search`, `type:grant`, about 1,900); ask each grant's published recipient
  count and total, 16 grants a query (the endpoint caps query complexity at 50 and refuses introspection), about
  120 requests; compare with what `state_grants` holds per program; re-read only the grants that differ, new
  ones first, up to `NSW_GRANT_BUDGET` a night (default 250, a few hundred requests), one reader with a 500 ms
  pause; save them with the program's stale lines removed; then build the page summary from everything stored.
  Roughly 950 grants carry awards, 52,000 lines and $13bn since 2022, so the first fill takes about four
  nights and the page says how many grants are still to come. The register is cumulative: every year's rows are
  kept and the page features the last full financial year with the year before for comparison. No ABN is
  published, so recipients group by name; individuals and any council area with five or fewer recipients are
  pooled by the publisher. A handful of awards whose amount the API cannot serve are left out and counted; their
  grants always look changed, so grants already read go to the back of the queue.
- Every other jurisdiction was probed endpoint by endpoint on 25 September 2026 (open-data catalogues, finder
  APIs, Treasury instructions, department recipient pages). None publishes a list of awards: Victoria, the ACT
  and the NT run finders of opportunities whose records carry no recipients; Victoria's, the NT's and the ACT's
  policies leave awards to each department's own pages or annual report; SA and Tasmania have single-program
  lists only, the newest from 2019-20 and 2018-19. On top of that, the department sites of SA, Tasmania, the NT,
  Victoria (business and regional development) and WA's content API all challenge or refuse non-browser clients.
  The exact reasons shown on the page are in `lib/sources/state-grants/index.ts`.
- WA is Lotterywest alone. Its grant recipients page lists every grant the board approved in the last year and
  is drawn from `/api/grants/approved` on the same site (pageSize capped at 500; the loader reads oldest first).
  It rolls forward a year at a time, so rows accumulate in the database rather than replacing a year, and there is
  no earlier period to compare with. The value is the amount approved, not paid. The site states full copyright
  and no open licence; the figures are shown with attribution as published public information, which the owner
  may want to revisit.
- Storage: `state_grants` keeps the fields every state shares as columns and every published column as JSON in
  `fields`, keyed by state, financial year and an id: the line's position for a file republished whole (Queensland,
  where a vanished line is deleted on the next load) or the grant's own facts for a rolling list (Lotterywest).
- The file covers more than grants: the "Assistance type" column also holds frontline service procurement
  (services bought from providers), concessions, loans and direct investment. The page's total is the whole file
  and the share that is grants proper is shown separately. Payments to individuals are pooled by program under
  a label with ABN 0: usually "Multiple" (the template's word), sometimes "Various", "Various - Confidential",
  "Individual athletes" or "NA". The loader treats all of those as pooled.
- The value is what was paid in the year, not the agreement's size; the agreement total to date is a separate
  column. About two thirds of lines have no agreement dates.
- Agencies are acronyms that change with every machinery-of-government change. Treasury's data dictionary lists the
  set used to November 2024; the December 2024 set is typed from the Administrative Arrangements Order. Any code
  not in the map is shown as published and listed on the page.
- The 2023-24 file carries an extra leading "Name" column (the agency file each line came from) and dd/mm/yyyy
  dates; 2024-25 has no "Name" column and ISO dates. Columns are read by heading, so both parse.

## Things to know about the company data

- Each ATO report also carries a few dozen late entries for earlier income years, so a company can appear twice.
  Headline figures use only the report's own year; the database stores every row under its own `income_year`.
- The ATO list is published once a year, about 18 months after the income year ends. A blank taxable income or tax
  payable cell means nil was reported. It covers foreign-owned companies but does not flag them, so neither does the site.
- Total income is gross revenue, not profit. Never present tax divided by total income as a tax rate.
- No tax payable has ordinary causes (carried-forward losses, offsets, a loss year). Keep the ATO's own caution beside any list of names.
- ASX earnings are not included: announcements are PDFs, ASX data is commercially licensed, and the unofficial free
  feeds bar republication.

## Things to know about the revenue data

- budget.gov.au always serves the current Budget, so the CSV URLs roll forward by themselves.
  Years marked `(est)` are estimates; charts use final figures only.
- The Parliamentary Budget Office publishes a longer history (back to 1901) but under CC BY-NC-ND,
  so it is deliberately not used here.

## Things to know about the AusTender data

- `contracts[].dateSigned` just repeats the publish timestamp, so it can't measure reporting delay.
  "Late" here means published more than 42 days after `contracts[].period.startDate`. The rule
  counts from the day a contract is entered into, which the API doesn't publish, so the start date
  is a stand-in. Say so whenever the figure is quoted.
- Categories are the first two digits of the UNSPSC code the agency chose (`lib/unspsc.ts`).
  Segments 70 and above are services.
- Amendments carry the tag `contractAmendment`, the same CN id as the original, and their own award id and page; the `-A1`
  suffix appears only on the web page. They are counted but excluded from totals. Only `contractLastModified` returns them
  reliably; `contractPublished` files them under the original publish date. `contracts[].dateSigned` equals the publish
  timestamp on an original notice and the original publish date on an amendment (see `docs/query-audit.md`).

## Check before posting figures

Open a few contracts from the tables and compare them with tenders.gov.au. Every contract ID on
the site links to its raw API record.

## Licence and how this is funded

This is the plan. It is not in force until a `LICENSE` file is added to the repository.

**Code: AGPLv3.** Anyone may run this code for free, including commercially, and including on their own servers
without changing it. The one obligation is on people who modify it and offer it to others over a network: they
must publish their changes under the same licence. That keeps the project open and stops it being turned into a
closed competing product. An app that only calls a hosted copy over HTTP is a separate program and is not affected.

**Data: the publishers' own licences.** The figures belong to the agencies that publish them, mostly under
Creative Commons Attribution (CC BY). Anyone reusing them must credit the source, whether they take them from here
or from the agency. Each source's licence is listed on the `/sources` page and in the table above. Two are not yet
confirmed (NSW and Tasmania), and the Victorian snapshot was gathered by hand from a register with no stated open
licence, so treat those three with care before redistributing them.

**Funding today: none.** The project is built and paid for by its owner. It has no sponsors, investors, grants or
paying users, and nothing is for sale. There is no hosted site or public API yet; it runs on a local machine.

**Funding planned: free for the public, paid for businesses.** None of this exists yet:

- The public site and the code stay free.
- A hosted API, free for non-commercial use, with attribution and fair-use limits.
- A paid plan for commercial users: a fixed monthly subscription for an API key, higher limits, stored history and
  revisions, bulk downloads and alerts (for example, when a given ABN wins a contract or grant).
- A way for individuals to chip in, such as GitHub Sponsors, once the repository is public.

Nothing would be locked away: the raw data is free from the agencies and the code is free here. What a business
would pay for is not having to run it. Keeping a dozen government feeds working is the actual job: reconciling
some 240 Queensland agency files, handling each state's export quirks, joining records by ABN, storing history,
and fixing it when a government site changes. Self-hosting is always allowed and is the right choice for anyone
who would rather do that work themselves.

The aim is a small business with open code, not a non-profit.
