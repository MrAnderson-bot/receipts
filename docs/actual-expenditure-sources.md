# Actual expenditure: the two sources that publish what was really spent

Written 25 September 2026 after the AusTender audit. Finance's own guidance (RMG-423) says "AusTender does not,
and is not intended to, reflect actual government expenditure": every contract value on the site is a ceiling.
These two sources publish what was actually paid. Both were tested by script on 25 September 2026: plain GET or
POST, no login, no key.

## 1. Finance, Commonwealth Monthly Financial Statements

- Index: https://www.finance.gov.au/publications/commonwealth-monthly-financial-statements
- One page per month, e.g. `.../commonwealth-monthly-financial-statements/2026/mfs-may`. The tables are in the
  page HTML (there is also a PDF, no spreadsheet). Latest on 25 September 2026: May 2026.
- Each table has five columns: line, actual for the month, actual year to date, the Budget's year-to-date profile,
  and the full-year estimate "as published in the 2026-27 Budget". Amounts in $m (the summary table in $b).
- Tables: aggregates (receipts, payments, underlying and headline cash balance, revenue, expenses, net operating
  balance, net capital investment, fiscal balance, assets, liabilities, net worth, net debt); the general
  government operating statement with every line (taxation revenue, supply of goods and services, wages, current
  grants, personal benefits, subsidies, interest, capital transfers ...); balance sheet; cash flow.
- Parse: split `<table>` rows, first cell is the line, then four numbers with commas and minus signs; footnote
  letters in brackets on line names. Store each line as a monthly series (`mfs:<line>` actual month, plus year to
  date and profile as their own series) so "spent so far against plan" is one chart.
- Contracts land in "Supply of goods and services" (about $206B year to date at May 2026 against $232B full year).

## 2. Transparency Portal, annual report tables (Department of Finance)

- Site: https://www.transparency.gov.au (a browser app; text fetches of it return nothing).
- Data API: `POST https://data.transparency.gov.au/api/datasets/simplified` with a JSON body:

      {"contentType": ["<table type>"], "entity": [], "bodyType": [], "entityCodename": ["<entity>"],
       "reportingPeriod": ["2023-24"], "tableCodename": [], "portfolio": [], "dataGroups": []}

  Empty arrays mean "all". The reply is `{ "entityData": [...], "portfolioData": [...] }`; each item has `entity`,
  `entityCodeName`, `portfolio`, `bodyType`, `reportingPeriod`, `contentType`, `tableType` ("fixed": `datafields`
  is one object; "row": `datafields` is an array of row objects), `annualReportTitle`, `annualReportUrl`.
- **Do not GET the endpoint with no filter**: it streams the whole portal (60 to 70 MB) and the server cuts it off
  before the end, twice out of two tries. Filtered calls return in under a second.
- Reporting periods present: 2018-19, 2019-20, 2022-23, 2023-24, 2024-25 (filling: 94 entities had their
  consultancy table on 25 September 2026). 2020-21 and 2021-22 are nearly absent, reason unknown; check on the site.
- Table types (`contentType`) that matter here, all present for 2023-24:

  | contentType | What it holds |
  |---|---|
  | `expenditure_on_reportable_consultancy_contracts` | new and ongoing consultancy contracts: number and $'000 paid in the year, GST inclusive |
  | `expenditure_on_reportable_consultancy_cont_____cop` | the same for **non-consultancy** contracts (a copied template; the title inside says "Non-Consultancy") |
  | `orgs_receiving_consultancy_contract_exp` | organisations paid for consultancy: name, ABN, $'000 |
  | `orgs_receiving_consultancy_contract_exp__copy__5778277` | organisations paid for non-consultancy contracts: name, ABN, $'000 |
  | `number_and_expenditure_on_consultants` | the older (2018-20) consultancy table |
  | `extract_dept__statement_of_comp_income___nce_23_24`, `extract_of_cash_flow_statement___nce_23_24_`, `extract_of_statement_of_financial_position_____cop` ... | the audited statement extracts; names carry the year and body type, so list them per entity first (query with `contentType: []` for one entity and one year) |
  | `commonwealth_leases___depart__leases_nce_23_24` | AASB 16 lease payments: principal, interest, depreciation, current and previous year |
  | `n17ad_da__remuneration_*`, `aps_*` | remuneration and staffing tables |

- The supplier tables list organisations above the reporting thresholds only: the big payees, not every payee.
- Licence: not yet checked. Confirm the portal's terms before anything from it goes on the site.

## What to build, in order

1. `lib/sources/finance-monthly.ts`: read the index for the latest month, parse the tables, store the lines as
   series. One page a day. Puts "spent so far this year against the Budget profile" on the Budget page.
2. `lib/sources/transparency.ts` plus tables `entity_contract_expenditure` (entity, year, consultancy or not,
   new/ongoing, number, amount) and `entity_supplier_payments` (entity, year, consultancy or not, organisation,
   ABN, amount). Fill by year from 2018-19; refresh the current year monthly as reports are tabled.
3. Join to `contract_releases` and `companies` by ABN: per supplier and agency, what was committed on AusTender,
   what the agency says it paid, and what the supplier paid in tax. This is the "commitment versus payment" gap
   that nothing publishes directly.
