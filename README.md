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
- `/states`: state and territory contracts (`/states/VIC`, `/states/QLD` and so on; NSW by default), plus the state with no usable data and why
- `/migration`: net overseas migration (ABS), temporary visa holders by category, permanent Migration Program outcomes, skilled and working holiday visas granted, NOM by visa category and new citizens by former citizenship (Home Affairs)
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
| `treasury.ts` | Budget Paper No. 1, Statement 5 online tables, CSV | Commonwealth receipts by source, % of GDP |
| `budget.ts` | Department of Finance Budget tables on data.gov.au, zip of CSVs plus xlsx (CC BY 4.0) | expenses by function, receipts/payments/balance since 1970-71, net debt, program expenses |
| `states/qld.ts` | about 240 Queensland agency contract disclosure files, via the data.qld.gov.au datastore API (CC BY 4.0) | state contracts, last 12 months |
| `states/nsw.ts` | buy.nsw register of notices, contract award report (CSV from a public form) | state contracts, last 12 months |
| `states/vic.ts` | snapshot file `data/states/vic.txt`, read by hand from the Buying for Victoria register | contracts of $5M and over, not a live feed |
| `states/nt.ts` | NT tenders site export of awarded contracts (xlsx), listed on data.nt.gov.au | state contracts, last 12 months |
| `states/tas.ts` | Tasmanian tenders site, awarded list plus one page per contract (HTML) | state contracts, rolling 30 days |
| `states/act.ts` | ACT Notifiable Invoices Register on data.act.gov.au (Socrata API, CC BY 4.0) | invoices of $25,000 and over, last 12 months |
| `apsc.ts` | APS Employment Database releases on data.gov.au, xlsx (CC BY 3.0 AU) | APS headcount by agency, gender and classification per half-yearly snapshot; totals by gender since 2006 |
| `aofm.ts` | AOFM data hub, Register of Government Borrowings and portfolio executive summary, xlsx (CC BY 4.0) | Australian Government Securities on issue, face value, monthly since 2010 |
| `states/wa.ts` | Tenders WA award CSV on data.wa.gov.au (CC BY 4.0) | state contracts, latest released financial year |
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
- Amendments (IDs ending `-A1`, or tag `contractAmendment`) are counted but excluded from totals.

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
