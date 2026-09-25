# Audit: what we ask the endpoints for, against what they offer

Written 25 September 2026. Method: pulled one full day (22 September 2026) from every AusTender OCDS
endpoint, listed every field path the API returned, and compared it with what `lib/sources/austender.ts`
reads and `lib/db/sqlite.ts` stores. Then read five notice pages of different kinds (open, limited with a
condition, limited with an exemption, one with an ATM and SON, one amended) and compared their labels with the
parser's list. Then downloaded a week of the GrantConnect report and listed its columns. Then profiled the
3,677 notice pages already stored in `data/receipts.db`.

The rule being checked is the one in the handover: per-record tables match the government's record
one-to-one, every field, so the agent can later see everything.

## Verdict

The contract query collects about half of what the API gives, misses almost every amendment notice, and the
notice-page parser corrupts three fields on every page because it doesn't know four of the page's labels.
Grants read 14 of 32 report columns. Approaches to market and standing offers are not collected at all,
although every notice page links to them. Details and fixes below, most serious first.

## 1. Amendments: the published-date endpoint hides them

The loader queries `findByDates/contractPublished`. An amendment notice keeps the original's publish date,
so it does not fall inside the window of the day it was made. Measured for 22 September 2026:

| Endpoint | Releases | Tagged `contractAmendment` |
|---|---|---|
| `contractPublished` (what we use) | 208 | 1 |
| `contractLastModified` | 389 | 100, of which 86 were made that day |

So the "amendments" count on the Contracts page, and the `amended` list in the snapshot, see about one
amendment in eighty. The 90-day summary's "counted but excluded" figure is wrong by that much.

`contractLastModified` returns the amendment release **and** the original release it modifies (84 originals
came back alongside on that day), so it is also a free way to get a notice's full history. `findById/CN...`
returns the same thing for one notice, and accepts the page's `CN1234-A1` form too.

Shape of an amendment release, which matters for the fix:

- `contracts[].id` is the plain `CN1234`, the same as the original. The `-A1` suffix exists only on the web
  page. The README's "IDs ending -A1" never occurs in the API; only the `contractAmendment` tag does. Zero
  rows in the database have a `-A` id.
- `awards[].id` carries a **new** GUID, so the amendment has its own page. That page shows the CN with the new
  value, an `Original:` line with the old value, and an `Amendments:` list ("CN4277294-A1 - Variation to
  contract value (22-Sep-2026)").
- `date` on the release is the amendment date. `contracts[].dateSigned` and `awards[].date` hold the
  **original** publish date. On a plain release all three are equal. The README's "dateSigned just repeats the
  publish timestamp" is true only for unamended notices.

**Amendments are not stored at all.** `getSummary` drops them before `saveContracts`, and the `contracts`
table is keyed on the CN id, so an amendment row would collide with its original anyway. `docs/backfill.md`
says "amendments go to the same table with their -A ids, as today"; that is not what happens today.

**Fix.** Query `contractLastModified` for the window (dedupe by release `id`, not CN id). Store one row per
**release** (release id is the key; ocid, CN id, tag, release date, and every field below), so an original
and each of its amendments are separate records, exactly as the API and the site hold them. Keep the
`contracts` table as the "current state of each CN" view, updated from the newest release. The `seen` map in
`getSummary` currently keeps the *first* release it meets for a CN; with the modified endpoint it must keep
the newest.

## 2. API fields read versus available

Every field path the API returned on 22 September, and whether we keep it. "JSON only" means it goes into
the stored page JSON but has no column; "no" means it is discarded.

| Field | In the API | Kept |
|---|---|---|
| `ocid`, release `id` | always | **no**. The only stable key for a release, and the link to the OCDS record |
| `date` | always | yes (`published`) |
| `tag` | always | **no**. Distinguishes `contract` from `contractAmendment`; used, then dropped |
| `initiationType`, `language` | always, constant | no; harmless |
| `contracts[].id` | always | yes |
| `contracts[].awardID` | always | yes (`award_id`, `page_id`) |
| `contracts[].title` | always | **no**. This is the Agency Reference ID (purchase order or file number). We read it from the page instead, and the page parser mangles it (see 3) |
| `contracts[].description` | always | yes |
| `contracts[].dateSigned` | always | **no**. Equals the original publish date; on an amendment it is the only API field giving the original date |
| `contracts[].status` | always | no (always `active` in the sample) |
| `contracts[].value.amount` | always | yes |
| `contracts[].value.currency` | always | no (always AUD in the sample; keep it, it is free) |
| `contracts[].period.startDate`, `endDate` | always | yes |
| `contracts[].items[]` | always, one item in every one of 208 | first item only. Store all items |
| `items[].classification.id`, `.scheme` | always | id yes, scheme no |
| `awards[].id` | always | yes |
| `awards[].date`, `.status` | always | **no**; `status` is null on amendment releases, `active` otherwise |
| `awards[].suppliers[].id`, `.name` | always | name only, via parties |
| `tender.id` | always | no (equals ocid) |
| `tender.procurementMethod` | always | yes |
| `tender.procurementMethodDetails` | always | **no**. "Open tender", "Prequalified tender", "Limited tender". Prequalified is the panel case and is lost under "open" |
| `tender.limitedTenderExempt` | on limited tenders | **no**. "1" on 119 of 137 limited tenders that day: the notice claims an exemption from open tender |
| `tender.exemptionCode`, `tender.exemption` | when exempt with a reason | **no**. e.g. `LP` "App A: 1. Leasing of immovable property" |
| `tender.limitedTenderReasonCode` | when a 10.3 condition is cited | **no** |
| `tender.limitedTenderReason` | when a 10.3 condition is cited | yes (`limited_reason`) |
| `parties[]` supplier: `id` | always | no |
| supplier `additionalIdentifiers` (ABN) | 191 of 208 | yes |
| supplier `address.streetAddress`, `locality`, `region`, `postalCode` | nearly always | **no** from the API; town, state and postcode come from the page into JSON only |
| supplier `address.countryName` | always | yes |
| supplier `contactPoint.branch`, `.division` | 98 of 208 | **no**. Despite sitting under the supplier party, these are the agency's branch and division (the page shows them under Agency Details). Organisational, not personal |
| supplier `contactPoint.name`, `.email`, `.telephone` | always | no, deliberately (personal contact details). Keep that rule |
| `parties[]` agency: `id`, `name` | always | name only |
| agency `additionalIdentifiers` (ABN) | always | **no**. The agency's ABN, the key for joining agencies across sources |

Consequence for one figure on the page today: `limited_reason` is null on 9,004 of the 10,148 limited-tender
rows, and the Contracts page shows "No reason given" for them. Most of those notices do state a reason: the
exemption flag and code, or the condition, which the loader never reads.

## 3. Notice page: four labels the parser does not know

The parser walks the page's labels and appends any unlabelled line to the field before it. Labels found on
real pages that are not in `LABELS`:

| Label | Where it lands now | Rows affected of 3,677 read |
|---|---|---|
| `Limited Tender Condition:` | appended to `procurementMethod`, so the reason text is hidden in "Limited tender Limited Tender Condition: 10.3.b. Extreme urgency..." and `limitedTenderExemption` stays null | 272 |
| `Original:` (old value, on amended notices) | appended to `value`, which then parses as NaN and is stored as null | 21 (every null `value` in the store) |
| `Amendments:` and the `CN1234-A1 - Variation ... (date)` lines | appended to `description` | 23 |
| `Supplier Details` heading | appended to `agencyReferenceId` ("N009729 Supplier Details") | 3,677: every row |
| `Branch:`, `Division:`, `Office Postcode:` under Agency Details | cut off with the contact block | all |

Two more things the page gives that the parser throws away before reading:

- The `ATM ID` and `SON ID` values are links, `/ATM/Show/<guid>` and `/Son/Show/<guid>`. The parser strips
  tags first, so the GUIDs are lost. Those GUIDs are the only way to reach the approach-to-market and standing
  offer records (see 5).
- The amendment list is structured (amendment id, reason, date). Read it as such.

Columns: `sonId`, `smeReason`, the two confidentiality reasons, `agencyReferenceId`, supplier name, town,
postcode and state are in the JSON blob only, with no `n_*` column. That is tolerable while the JSON is right,
but the JSON is what is corrupted above, so the fix must re-read the affected pages (or all 3,677; at 1,500
a night that is three nights).

**Fix.** Add the missing labels; treat `Original` and `Amendments` as their own fields (old value; list of
{id, reason, date}); stop at `Contact Name` rather than at `Agency Details` so branch, division and office
postcode are read; capture the two GUID hrefs before stripping tags; clear `notice_read_at` on rows whose
JSON shows the damage so they are re-read.

## 4. Query mechanics

- **Page cap.** `fetchWindow` stops silently at 60 pages (6,000 notices) per 7-day window. The busiest week
  of the year, 24 June to 1 July 2026, was 2,089 notices over 22 pages, so nothing has been lost yet, but a
  silent cap should be an error, and the backfill will hit end-of-June weeks in earlier years too.
- **Duplicates.** The API returned the same CN twice within a `contractPublished` day once in 208, identical
  both times. With `contractLastModified` a CN appears once per release, deliberately, so dedupe on release id.
- **Windows.** Seven-day windows fetched in parallel is fine for the live 90 days. For the backfill the plan's
  month-by-month walk should use `contractLastModified` too, or amendments made after the month will be missed
  forever.
- **Late measure.** "42 days from period start" stands; nothing in the API gives the execution date. The page
  does (`Execution Date`), and it is read, so once every page is read the late figure can switch to the real
  execution date. That is the number the rule is actually about.
- **`findById`** is not used. It is the right call for re-reading one notice's history (all releases in one
  response) and for confirming a page id.

## 5. Records not collected at all: approaches to market and standing offers

AusTender has three record types. The API covers only contract notices. The other two are on the site and
are fetchable by script by the GUID each notice page links to (tested 25 September 2026; the human-readable
ids `DTA-ICT-50582` and `SON4102906` redirect to NotFound, the GUIDs work):

- **ATM page** (`/ATM/Show/<guid>`): ATM ID, agency, category, close date and time, publish date, location,
  ATM type (Request for Tender, Expression of Interest ...), multi-agency access and type, panel arrangement,
  multi-stage, description, other instructions, conditions for participation, timeframe for delivery, address
  for lodgement, contact details. The tender that produced a contract, with its closing date, is what makes
  "how many bid, how long was it open" answerable.
- **SON page** (`/Son/Show/<guid>`): SON ID, title, agency, publish date, standing offer period, panel
  arrangement, multi-agency access and type, procurement method, primary and secondary category, ATM ID,
  agency reference, description, amendments, and the list of panel suppliers with ABNs and the notes on
  novations, name changes and terminations. Panels are where most limited-tender spend goes; without the SON
  record the "prequalified" contracts have no parent.

Neither is in `docs/backfill.md`. They belong there as two more per-record tables (`atms`, `standing_offers`,
plus `standing_offer_suppliers`), filled from the GUIDs collected by the notice crawl, at the same polite rate.

## 6. GrantConnect: 14 of 32 columns read

The report download for a week (18 to 25 September 2026) has these columns. Bold ones are not read by
`toGrant`:

Agency, GA ID, **Internal Reference ID**, **GO ID**, Recipient Name, Recipient ABN, **PBS Program Name**,
Grant Program, **Grant Activity**, Purpose, One-off/Ad hoc, **Aggregate**, **Aggregate Reason**,
**Aggregate Number**, Selection Process, Category, **Confidentiality - Contract**, **Confidentiality -
Outputs**, Publish Date, **Approval Date**, Start Date, End Date, Value (AUD), **Recipient Suburb**,
**Recipient Town/City**, **Recipient Postcode**, **Recipient State/Territory**, **Recipient Country**, Delivery
State/Territory, **Delivery Postcode**, **Delivery Country**, **Contact Name** (personal; leave it out).

`GO ID` links the award to the grant opportunity, which has its own page on GrantConnect with the opportunity's
closing date, eligibility and selection process, the grants counterpart of the ATM. `Approval Date` is the
date the 21-day publication rule actually counts from; the loader uses Start Date as a stand-in because it
never reads Approval Date. There is still no per-record `grants` table (known; in the backfill plan).

**Fix.** Read every column into a `Grant` record and a `grants` table keyed by GA ID, with the same
first-seen and last-seen handling as contracts; measure lateness from Approval Date; note GO ID for a later
`grant_opportunities` table.

## 7. Sources checked and found complete

- **Asset sales** (`finance-sales.ts`): the Finance page has three tables (trade sales, share offers,
  scoping studies). Every cell of the first two is read (date, name, proceeds, qualifier); the third is
  studies, not sales, and is skipped on purpose. The page gives no buyer, so the working copy's added
  government, unit and buyer fields are annotations from other sources and should say so on the page.
  The whole list, not a summary, is what the snapshot stores, so it is one-to-one with the page.
- **IPEA expenses**: every report column is a table column, by construction.
- **APS headcount**: every cell of the agency table is a row.
- **ATO companies**: the six columns read are name, ABN, income year, total income, taxable income, tax
  payable. Whether the ATO sheets carry more columns in some years (they have in the past, for resource rent
  taxes) was not checked in this audit.
- **Fuel**: every field each scheme gives, replaced daily, by the documented disk rule.
- **State contracts**: summaries only, no per-record tables (known; in the backfill plan). Not audited field
  by field here.

## Order of work

1. Switch the contract query to `contractLastModified`, dedupe by release id, keep the newest release per CN
   for the summary. One change in `fetchWindow` and `getSummary`. Fixes the amendment count immediately.
2. Add a `contract_releases` table (one row per release, every API field in section 2 as a column, whole
   release as JSON) and write every release to it. Keep `contracts` as the current-state view.
3. Fix the page parser (section 3), add the missing `n_*` columns, and re-read the damaged pages.
4. Read all 32 grant columns; create the `grants` table.
5. Add `atms` and `standing_offers` tables and a polite crawl from the GUIDs the notice pages give.
6. Make the 60-page cap an error. Update the README line about `-A1` ids and `dateSigned`, and the
   backfill plan's line about amendments.

## 8. The forward pipeline: planned procurements, open ATMs, standing offers

Added after the owner asked for vision on what agencies are looking to buy, not only what they have bought.
Checked 25 September 2026; every route below is a plain GET with a browser-style user agent, no login.

AusTender publishes three stages before a contract exists, and the site links each stage to the next:

| Stage | Where | What it gives | Link to the next stage |
|---|---|---|---|
| **Annual procurement plan** (intent, by financial year) | `/App/List?Tab=List By Agency` lists agencies; `/App/Show/<guid>` is one agency's plan; `/App/Download/<guid>` is the same as a spreadsheet | one row per planned procurement: agency reference, description, UNSPSC category, estimated quarter of approach to market (with the original quarter when it slips), multi-agency access, status (To Market ...), change comments, last updated | the `ATM's` column names the ATM once it is published |
| **Approach to market** (open request) | `/public_data/rss/rss.xml` lists every currently open ATM (99 on the day) with its GUID; `/Atm/Show/<guid>` is the record | ATM id, agency, category, publish and close date, ATM type, location, panel and multi-agency flags, multi-stage, description, conditions for participation, timeframe for delivery | the contract notice's `ATM ID` field links back by GUID |
| **Standing offer** (panel) | `/Son/Show/<guid>`, reached from any contract notice bought off it | SON id, title, agency, standing offer period, categories, procurement method, the parent ATM, amendments, and every panel supplier with ABN plus novations and terminations | contract notices carry the `SON ID` |

What this makes possible: a count and category mix of requests in the pipeline by agency and quarter; how
long ATMs stay open; how often plans slip (the plan row keeps its original quarter); which panels are live
and until when; and a forecast of spend by joining each stage to the awards that followed the same
category and agency in past years. None of the three stages carries a dollar figure. That is by design on
the site, so any "future spending" number is our estimate from history and must be labelled as such.

Two things not yet solved: the by-agency page links only 15 agency plans directly, and the other agencies are
reached by choosing them in the form, so the plan GUID per agency has to be found once (the dropdown lists
about 140); and the site has no listing of closed ATMs, so ATM history builds up from the daily RSS read plus
the GUIDs on notice pages. The RSS feed should be read every day and every GUID stored the first time it is
seen.
