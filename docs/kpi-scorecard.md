# Government scorecard: design and data

Written 25 September 2026. The code is `lib/scorecard.ts`; the page is `/scorecard`. This file explains the
choices, lists every indicator with its rule and data status, and says what is still missing.

## What it is for

A fixed set of key performance indicators for how the country is going under the government of the day, on
affordability, housing, jobs, the budget, investment and procurement. The same test is applied every day, from
official figures only, with every rule printed beside its result. It exists so that "is it getting better?"
has a stable answer that doesn't move with the news cycle, and so the prediction engine has a scoreboard to
model against later.

## Principles (same as the recession watch)

1. **A count, not a model.** Each indicator is met, missed or no data. The score out of 100 is the share of
   readable rules met, rounded, every rule counting the same; a group's score is the same calculation over its own
   rules, and a second figure applies it to the government's published targets alone. No weights, no probability.
   Anyone can check the score by counting the tables. Every missed rule states what has to change to meet it
   (`toMeet`), and the page lists those gaps by group, weakest first, as "what would lift the score".
2. **Two kinds of rule, marked apart.** *Published*: the government's own target (the Housing Accord, the
   inflation target, the fiscal strategy's gross debt commitment). *Yardstick*: ours, because no target exists.
   A yardstick is stated in plain words on the page and the reader can disagree with it. Most direction
   yardsticks are "no worse than a year earlier", which needs no number to be argued about.
3. **Official sources, final figures.** Budget rules read only years with a final outcome, never estimates,
   because estimates change with every Budget. ABS and RBA figures are the seasonally adjusted series where
   one exists.
4. **Missing data is left out, not assumed.** An indicator whose source didn't answer is shown as "no data"
   and drops out of the denominator.
5. **Neutral wording.** Indicators describe systems and outcomes, never people. A missed indicator is a fact
   about the country, not a charge against anyone.
6. **Changing a rule changes the page.** Thresholds live once, in `lib/scorecard.ts`, and the rule text is built
   from them. If a threshold changes, note it here with the date and the reason.

## The indicators

Status on 25 September 2026: **have** means the series is fetched and stored today; **added** means it was
added with the scorecard (keys checked against the publisher's API that day).

### Affordability: is a pay packet going further than a year ago?

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Wages growing faster than prices | Real wage growth (WPI growth minus CPI growth, year on year) at or above zero | Yardstick | have `wages`; added `cpi-quarterly` (ABS CPI index, `1.10001.10.50.Q`); derived `real-wages` |
| Inflation inside the target band | Annual CPI between 2% and 3% | Published: Statement on the Conduct of Monetary Policy | have `cpi` |
| Rents rising no faster than wages | CPI rents (year on year, at the wage quarter's end) no more than WPI growth | Yardstick | have `cpi-rents`, `wages` |
| Essentials rising no faster than prices overall | None of groceries, electricity, gas, fuel above headline CPI | Yardstick | have all four CPI parts |
| New mortgage rate not rising | RBA F6 new variable owner-occupier rate no higher than a year earlier | Yardstick (set by lenders, not government) | added `mortgage-rate` (RBA F6 `FLRHOFVA`, from 2019) |
| Household debt not growing faster than income | RBA E2 household debt to income no higher than a year earlier | Yardstick | added `household-debt-income` (RBA E2 `BHFDDIT`, quarterly) |
| Home prices rising no faster than wages | ABS mean dwelling price growth no more than WPI growth | Yardstick | added `dwelling-price` (ABS `RES_DWELL_ST` `5.AUS.Q`) |
| Credit card debt not growing in real terms | Interest-bearing balances growth no more than CPI | Yardstick | have `credit-card-debt` |

### Housing supply: are homes being built at the promised rate?

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Homes completed at the Accord rate | Completions over the latest four quarters at or above 240,000 (1.2M over 5 years from 1 July 2024, spread evenly); reading also shows the running total since July 2024 against what is due | Published: National Housing Accord | have `dwellings-completed` |
| Homes approved at the Accord rate | Approvals over the latest twelve months at or above 240,000 | Published (leading indicator of the same target) | have `building-approvals` |
| Homes keeping up with population | New residents per new dwelling at or below 2.5 | Yardstick (average household size) | have `housing-pressure` |

The Accord has no published yearly profile. An even 240,000 a year is used and the page says so. If the
government publishes a profile, use it and note the change here.

### Jobs and growth

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Economy growing per person | Real GDP per capita up in the latest quarter | Yardstick | have `gdp-per-capita` |
| Unemployment not rising | Rate no higher than a year earlier | Yardstick (no numeric full-employment target exists) | have `unemployment` |
| Participation not falling | Rate at least a year earlier's | Yardstick | added `participation` (ABS LF `M12.3.1599.20.AUS.M`) |
| Underemployment not rising | Rate no higher than a year earlier | Yardstick | added `underemployment` (ABS LF_UNDER 1.0.1 `M23.3.1599.20.AUS.M`) |
| Productivity growing | GDP per hour worked index at least a year earlier's | Yardstick | added `productivity` (ABS ANA_AGG `M5.GPM_PHW.20.AUS.Q`) |

### Budget and debt

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Gross debt falling as a share of GDP | AGS on issue ÷ last four quarters of nominal GDP, lower than a year earlier | Published: fiscal strategy (Budget Paper 1, Statement 3: gross debt as a share of GDP on a downward trajectory) | have `ags-on-issue` (AOFM); added `gdp-nominal` (ABS ANA_EXP `C.GPM.SSS.20.AUS.Q`); derived `gross-debt-share-gdp` |
| Budget balance improving | Underlying cash balance % GDP, latest final year at least the year before's | Yardstick | have (Budget table 11.1) |
| Net debt not rising as a share of GDP | Latest final year no higher than the year before's | Yardstick | have (table 11.4) |
| Interest bill not rising as a share of GDP | Net interest % GDP, latest final year no higher | Yardstick | added column `netInterestShare` (table 11.4) |
| Real spending growth within 2% a year | Payments real growth, latest final year, at or below 2% | Yardstick: the ceiling the fiscal strategy used 2014 to 2022; the current strategy gives no number | added column `paymentsRealGrowth` (table 11.1) |
| Tax take not rising as a share of GDP | Receipts % GDP, latest final year no higher | Yardstick (the 23.9% cap was dropped in 2022, so direction is used) | added column `receiptsShare` (table 11.1) |

### Investment

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Public investment holding up as a share of GDP | Public GFCF ÷ nominal GDP at least a year earlier's | Yardstick | added `public-investment` (ABS ANA_EXP `C.GFC.GSS.20.AUS.Q`); derived `public-investment-share` |
| Commonwealth net capital investment not falling | Net capital investment % GDP, latest final year at least the year before's | Yardstick | added columns from Budget table 11.6 |

"Investment strategy" is the thinnest group because the government publishes no target for it. Two more
indicators are worth adding when their data is wired (see below): infrastructure's share of contract value, and
research and development's share of GDP.

### Procurement

| Indicator | Rule | Basis | Data |
|---|---|---|---|
| Contracts reported on time | No more than 5% of the last 90 days' contracts published after the 42-day deadline in the Commonwealth Procurement Rules | Yardstick (the rules require 100%; 5% is our allowance). "Late" is measured from the start date, as everywhere on the site | have (`tryGetSummary(90)`) |
| Most contract value through open competition | No more than 25% of contract value by limited tender | Yardstick, temporary | have |

Both procurement thresholds are placeholders. The right rule is "no worse than the same 90-day window a year
earlier", which needs a year of stored `snapshots` rows. The nightly job has stored the 90-day contracts
summary since 22 September 2026, so from late September 2027 switch both to year-on-year and record the change
here.

### Response: is planned spending growing at least as fast as the pressure it answers?

Added 25 September 2026 at the owner's request: "does the government's allocation look appropriate given the crisis
at home". The allocation is the latest Budget's expenses by function, read as the Budget year against the Budget's
own estimate for the year before. Both are estimates: this is the one group that reads them, because an allocation
is a plan by definition, and the method text says so. The pressure is the latest twelve-month growth in the figure
that measures the problem. Met when the plan grows at least as fast as the pressure; a falling pressure is met by
any allocation. All five are yardsticks; the government publishes no allocation targets of this kind.

| Indicator | Allocation (Budget function) | Pressure | Data |
|---|---|---|---|
| Housing spending keeping pace with rents | Housing and community amenities | CPI rents, latest twelve months | have `cpi-rents`; Budget functions from `budget.ts` |
| Welfare spending keeping pace with prices | Social security and welfare | Headline CPI, latest twelve months | have `cpi` |
| Housing spending keeping pace with homelessness | Housing and community amenities | People helped by specialist homelessness services, latest financial year on the one before (AIHW) | have `homelessness:shs-clients:AUS`, passed in by the page from the homelessness loader |
| Public order spending keeping pace with offending | Public order and safety | Offenders per 100,000 people, latest financial year on the one before (ABS). The ABS publishes no national total of victims across offences | have `crime:offender-rate:AUS:total`, passed in from the crime loader |
| Energy spending keeping pace with power and fuel bills | Fuel and energy | The fastest-rising of CPI electricity, gas and automotive fuel, latest twelve months | have all three |

Known limits, to say on the page if asked: a function is broader than the crisis (housing and community amenities
includes water and sewerage; fuel and energy is mostly fuel tax credits and rebates, so it swings with rebate
timing, which is why it read −20.6% for 2026-27 on the day this was built); the Budget year's figure is a plan
that will be revised; and a growth comparison says nothing about whether the base level was right. The Response
group is a direction test, not an adequacy test. When the ABS Government Finance Statistics actuals by purpose are
loaded (backfill unit 2) the same rules can be run over actual spending as a second view.

## Backfill and history

The scorecard reads live sources, so every rule works from the first day: each rule needs only the latest
value and the same period a year earlier, and every ABS and RBA series is fetched from 2016. Budget rules read
the historical tables, which go back to 1970-71 for cash figures and 1996-97 for accrual ones.

What the database does **not** yet have is a daily record of the scorecard itself. Two things to add to the
nightly job so progress can be charted rather than only read today:

1. Store the scorecard result as a snapshot (`source = "scorecard"`, one row a day: each indicator's status,
   reading and as-of period). Then a chart of "indicators met" over time is a query, and any rule change is
   visible as a step.
2. Store the 90-day contract summary's `lateCount`, `knownStartCount`, `limitedValue` and `totalValue` as
   daily series, so the procurement rules can switch to year-on-year in 2027.

The owner noted that government spending is not backfilled beyond the latest year. That does not block the
Budget rules (they read the published historical tables, not the site's own history), but it does mean the
Budget snapshot only shows how the *estimates* have moved since 22 September 2026.

## Not tracked yet, and where the data is

| Gap | Why it matters | Source | Effort |
|---|---|---|---|
| Emissions against the 43% by 2030 target | The other large published target with a number | DCCEEW quarterly update (XLSX on the department's site) | New source module |
| Infrastructure share of contract value | Investment strategy as seen in procurement | Already in `categories` (UNSPSC segments 72, 95); needs a fixed list of "capital" segments | Small |
| R&D as a share of GDP | Investment in future productivity | ABS Research and Experimental Development (two-yearly, spreadsheet) | New source module |
| SME share of contracts | A published target: 20% of contracts by value to SMEs, 35% for contracts under $20M | AusTender doesn't flag SMEs in the API or notice page; the Finance procurement statistics publication does, yearly | New source, yearly only |
| Bulk-billing rate | The most-quoted health affordability figure | Department of Health quarterly Medicare statistics | New source module |
| State budgets and debt | The scorecard is Commonwealth-only above the ABS public-sector totals | ABS Government Finance Statistics (in the Data API) | Medium |
| Homelessness and crime as outcomes | The Response group reads them as pressures; a direction rule on the outcomes themselves (fewer people needing services, fewer offenders) is still to add | Have (AIHW, ABS) | Small |
| Energy bills in dollars | CPI electricity is a growth rate; a dollar figure is what people feel | AER default market offer (yearly) | New source, yearly |

## Changes to the rules

- 25 September 2026: first version. Thresholds: inflation 2 to 3%; Accord 240,000 a year; household size 2.5;
  real payments growth 2%; late notices 5%; limited tender 25%.
- 25 September 2026: Response group added, five rules, no thresholds (met when allocation growth is at least the
  pressure's growth). First reading: 4 of 5 met; fuel and energy missed (−20.6% against electricity +6.1%).
