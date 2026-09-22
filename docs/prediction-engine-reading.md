# Prediction engine: reading notes

Read 19 September 2026. Notes on how central banks and universities build forecasting and policy simulation
models, and what each means for this project. Read through a page summariser, not line by line, so check a figure
against the source before quoting it publicly. See `HANDOVER.md` for where the engine sits in the plan.

## Reserve Bank of Australia: MARTIN (RDP 2019-07)

https://www.rba.gov.au/publications/rdp/2019/2019-07/full.html

The RBA's model of the Australian economy, used for forecasts and "what if" scenarios. The closest published
blueprint for stage 3 (how a change flows through the economy).

- Over 30 behavioural equations plus accounting identities. Quarterly data, mostly ABS and RBA.
- Blocks: consumption, dwelling investment, housing prices and rents, business investment (mining and non-mining),
  exports and imports, employment, unemployment (Okun's law), wages (Phillips curve), inflation (mark-up over unit
  labour costs and import prices), cash rate rule, mortgage and business lending rates, exchange rate.
- Almost every equation is an error-correction model: a long-run relationship set by theory, and a short-run
  equation fitted to data that pulls the variable back toward the long run. Speed of adjustment is estimated.
- Long run is pinned by balanced-growth restrictions: income elasticities of 1, wage growth = inflation +
  productivity growth, inflation returns to 2.5%, unemployment returns to its trend rate. Long-run assumptions:
  productivity growth 1.5%, population growth 1.25%, potential GDP growth 2.75%.
- Expectations are not forward-looking. Inflation expectations are built outside the model and fed in.
- Cash rate rule is calibrated, not estimated: 0.7 weight on last quarter's rate, 0.3 on a target made of the
  neutral rate, inflation's gap from 2.5%, the unemployment gap (weight 2) and the change in unemployment.
- Samples: real activity from the 1980s, wages and inflation from about the 1990s (inflation targeting).

Published responses, useful as a sanity check for our own model:

| Shock | GDP | Unemployment | Underlying inflation |
|---|---|---|---|
| Cash rate +100bp for 4 quarters | -0.8% at 6 quarters | +0.3pp | a little under -0.2pp after 2 years |
| Real exchange rate -10%, temporary | +1% after 1 to 2 years | -0.4pp | +0.3pp |
| Housing prices -10%, persistent, no rate response | a bit over -1% after 1 to 2 years | +0.4pp | -0.2pp |

With a 75bp rate cut in response, the housing shock's peak effect roughly halves and variables return to baseline
within three years. Of the cash rate effect on GDP, about a quarter runs through the exchange rate and close to half
through asset prices. Dwelling investment is the most rate-sensitive component (down a bit over 3%).

- No government spending or tax shock is shown. Fiscal multipliers have to come from somewhere else.
- Stated limits: no banking sector, no industry detail, no confidence measures, supply side mostly fed in from
  outside, foreign economy fed in from outside.
- Download: an EViews workfile and programs that run the scenarios. EViews is paid software. Several series are
  simulated stand-ins because the real ones are proprietary (housing prices, bond yields, trading partner GDP), so
  results won't exactly match the paper. **Terms: "academic and personal use only", and the paper must be cited.**
  Learn from it; do not ship their code or files in anything commercial.

A cut-down version for this project would keep about 13 equations: consumption, dwelling investment, business
investment, exports, imports, employment, unemployment, wages, inflation, cash rate rule, exchange rate, lending
rates, housing prices, plus the GDP identity. Fixed coefficients and fixed trend growth instead of the RBA's
time-varying ones.

## Monash: Forecasting: Principles and Practice (3rd ed.)

https://otexts.com/fpp3/ (R) and https://otexts.com/fpppy/ (Python). Free. The rulebook for stage 1.

- Never judge a model on how well it fits the data it was trained on. Hold back a test set, about 20% of the data
  and at least as long as the longest forecast horizon.
- Better: rolling-origin cross-validation. Forecast from many past dates using only what came before each one, and
  average the errors. This is what the `first_seen` column in `observations` makes possible with real-time data.
- Accuracy measures: MAE and RMSE for one series; avoid MAPE near zero; use MASE to compare across series. MASE
  under 1 means the model beats the naive "same as last period" forecast. That is the number for a public
  scoreboard.
- Errors grow with the horizon. Always publish a prediction interval; the book says a point forecast is close to
  worthless without one. Bootstrapped intervals when errors aren't normally distributed.
- Chapters: graphics, decomposition, the forecaster's toolbox, regression, exponential smoothing, ARIMA, dynamic
  regression, hierarchical series (relevant: state figures adding to national), practical issues.

## QuantEcon: A First Course in Quantitative Economics with Python

https://intro.quantecon.org/intro.html. Free, by Sargent and Stachurski. Teaches modelling through code.

Lectures that map to this project: AR(1) processes; univariate time series with matrix algebra; simple linear
regression; tax smoothing; the four monetary-fiscal lectures (deficits, price levels, Laffer curves); input-output
models; the lake model of employment; Solow-Swan growth; Monte Carlo. Intermediate and advanced courses follow.

## US Federal Reserve: FRB/US

https://www.federalreserve.gov/econres/us-models-about.htm. In use since 1996. Equations, data, documentation and
Python code are a free public download (Python since April 2022). Two ways of handling expectations: from
historical patterns, or consistent with the model's own forecasts. A linear version (LINVER) runs much faster. Worth
reading as a working codebase even though it is the US economy.

## New York Fed Staff Nowcast

https://www.newyorkfed.org/research/staff_reports/sr1152. A dynamic factor model: a few hidden factors summarise
many indicators, and the estimate of current-quarter GDP updates weekly as data arrives. The newer component-based
version nowcasts each part of GDP so the parts add up to the total, and reports about 15% lower error than the
standard version. Could not read the detail on missing data and mixed frequencies.

## Policy simulators

- **PolicyEngine** (https://policyengine.org/us/model). Open-source Python, public website where anyone changes a
  tax or benefit setting and sees the result. Three ingredients: the rules written as code (55+ US programs), a
  representative sample of households, and behavioural response figures. Steps: work out every household's tax
  under current rules, again under the reform, apply labour supply responses, add up with weights. Validates by
  comparing against official models. US and UK; no Australian model seen. The nearest thing to this project's
  public "what if" page.
- **ANU PolicyMod**. Australian personal tax and welfare system on the ABS Survey of Income and Housing 2019-20.
  Static ("day after") model: no behaviour change. Reports winners and losers by family type, income decile, housing
  tenure. Also does **cameo analysis**: the effect on a few hypothetical families. Cameos need only the rules, not
  the household survey, so they are buildable here now.
- **Penn Wharton Budget Model** (https://budgetmodel.wharton.upenn.edu/model/). Simulated population of hundreds of
  thousands of people calibrated to census data, 60+ attributes, linked to a model where households change work and
  saving when policy changes. Tax, spending and social security modules. Tested on history before use.
- **University of Canberra STINMOD**. The older Australian tax and welfare microsimulation; PolicyMod's lead
  previously ran it.

Population-wide winners-and-losers analysis needs household survey microdata, which this database does not hold.

## Victoria University Centre of Policy Studies: ORANI-G

https://www.copsmodels.com/oranig.htm. Whole-economy model built on input-output tables (who buys what from whom),
22 to 100+ industries. A simulation is a shock (say a tariff change) plus a "closure" (which variables are allowed
to adjust). Needs GEMPACK, paid software with a limited free version. Documentation, older model versions with data
and course materials are free. Too big to build here; useful for how industry flow-through is thought about.

## Not read

- Yale Budget Lab on feeding a budget costing into FRB/US: page too long for the reader.
- New York Fed nowcast method detail.

## What this changes in the plan

1. **Stage 1 (forecaster):** rolling-origin testing on real-time data, a public scoreboard using MASE against the
   naive forecast and against RBA forecasts, prediction intervals on everything.
2. **Stage 2 (budget simulator):** start with budget arithmetic and cameo calculators. Population-wide results wait
   on household microdata.
3. **Stage 3 (flow-through):** error-correction equations in MARTIN's block layout, about 13 equations, written
   fresh and estimated on our own stored series. Check our responses against MARTIN's published table above.
4. **Gap:** MARTIN publishes no fiscal shock. Find a usable, properly licensed source for spending and tax
   multipliers (not the Parliamentary Budget Office; see HANDOVER decisions).
