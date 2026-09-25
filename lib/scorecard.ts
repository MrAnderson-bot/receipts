// Government scorecard: a checklist of key performance indicators, each a fixed
// rule over an official figure. Where the government has published a target
// (the Housing Accord, the inflation target, the fiscal strategy) the rule is
// that target. Where it hasn't, the rule is a plain yardstick and says so, and
// the reader can disagree with it. Nothing is weighted: the score out of 100 is
// the share of readable rules met, and every missed rule says what has to
// change to meet it.
// The method text on the page is the contract; change a rule here and the
// page text changes with it. Design notes: docs/kpi-scorecard.md.
import type { Series, SeriesResult } from "./sources/types";
import type { Budget } from "./sources/budget";
import type { YearValue } from "./sources/treasury";
import type { Summary } from "./sources/austender";
import { value as fmt, period, money, pct } from "./format";
import { yearEarlier, yearOnYear } from "./derived";

export type Status = "met" | "missed" | "no-data";
export type Basis = "published" | "yardstick"; // published: the government's own target. yardstick: ours, stated on the page.

export type Kpi = {
  id: string;
  name: string;
  status: Status;
  reading: string; // the figure the rule was applied to, in words
  toMeet: string | null; // when missed: what has to change for the rule to be met, in words
  asOf: string | null; // period of the latest figure
  rule: string; // exactly what counts as met, and where the threshold comes from
  basis: Basis;
  href: string; // where the underlying figure is shown with its source
};

export type Pillar = {
  id: string;
  name: string;
  question: string; // what the pillar asks, in one line
  met: number;
  scored: number; // indicators that could be read
  score: number | null; // met as a share of scored, 0 to 100; null when nothing could be read
  kpis: Kpi[];
};

export type Scorecard = {
  pillars: Pillar[];
  met: number;
  scored: number;
  total: number;
  missing: string[]; // indicators with no data this time
  score: number | null; // met as a share of scored, 0 to 100
  targetsScore: number | null; // the same, over the government's own published targets only
  method: string;
};

// Every series the scorecard reads. Pages that show it fetch these.
export const SCORECARD_INPUTS = [
  "real-wages", "cpi", "cpi-rents", "cpi-food", "cpi-electricity", "cpi-gas", "cpi-fuel", "wages",
  "mortgage-rate", "household-debt-income", "dwelling-price", "credit-card-debt",
  "dwellings-completed", "building-approvals", "housing-pressure",
  "gdp-per-capita", "unemployment", "participation", "underemployment", "productivity",
  "gross-debt-share-gdp", "public-investment-share",
];
// Series the Response group reads that come from the crime and homelessness loaders, not the indicator list.
// The page passes them in as extra series.
export const SCORECARD_EXTRA_IDS = ["homelessness:shs-clients:AUS", "crime:offender-rate:AUS:total"];
const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// "2026-27" -> "2025-26"
const previousYear = (fy: string) => { const y = Number(fy.slice(0, 4)) - 1; return `${y}-${String(y + 1).slice(2)}`; };

// The National Housing Accord: 1.2 million new well-located homes over five years from 1 July 2024.
export const ACCORD = { homes: 1_200_000, years: 5, from: "2024-Q3", perYear: 240_000, perQuarter: 60_000 };
export const INFLATION_TARGET = { low: 2, high: 3 }; // Statement on the Conduct of Monetary Policy
export const LATE_SHARE_LIMIT = 5; // % of contracts reported after the 42-day rule in the Commonwealth Procurement Rules
export const LIMITED_SHARE_LIMIT = 25; // % of contract value awarded without open competition
export const REAL_PAYMENTS_GROWTH_LIMIT = 2; // % a year: the ceiling the fiscal strategy used from 2014 to 2022

type Reading = { ok: boolean; reading: string; asOf: string | null; toMeet?: string };
type Spec = Omit<Kpi, "status" | "reading" | "asOf" | "toMeet"> & { read: () => Reading | null };

const last = (s: Series) => s.points[s.points.length - 1];
const at = (s: Series, p: string) => s.points.find((x) => x.period === p)?.value ?? null;
const yearAgo = (s: Series) => at(s, yearEarlier(last(s).period));
// 2026-Q2 -> 2026-06, to read a monthly series at the end of a quarter.
const quarterEnd = (q: string) => {
  const m = q.match(/^(\d{4})-Q([1-4])$/);
  return m ? `${m[1]}-${String(Number(m[2]) * 3).padStart(2, "0")}` : q;
};
const sumLast = (s: Series, n: number) => (s.points.length >= n ? s.points.slice(-n).reduce((a, p) => a + p.value, 0) : null);
const pts = (n: number) => fmt(n, "pts", 1);
const pc = (n: number, d = 1) => fmt(n, "%", d);
const signed = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

// Met as a share of readable, 0 to 100. Every rule counts the same; that is the whole method.
export const score = (met: number, scored: number) => (scored ? Math.round((met / scored) * 100) : null);

// Budget years: the latest final outcome and the one before it.
function lastActuals(series: YearValue[]): [YearValue, YearValue] | null {
  const actual = series.filter((p) => !p.estimate);
  return actual.length >= 2 ? [actual[actual.length - 2], actual[actual.length - 1]] : null;
}

export function scorecard(results: SeriesResult[], budget: Budget | null, contracts: Summary | null, extra: Series[] = []): Scorecard {
  const byId = new Map(results.filter((r) => r.series?.points.length).map((r) => [r.id, r.series!]));
  for (const x of extra) if (x.points.length) byId.set(x.id, x);
  const s = (id: string) => byId.get(id) ?? null;

  // Reads a series a year apart. `better` says which direction counts as met.
  const yearOnYearRule = (id: string, better: "lower" | "higher", unit: "%" | "index" = "%", decimals = 1) => (): Reading | null => {
    const x = s(id);
    if (!x) return null;
    const now = last(x), then = yearAgo(x);
    if (then === null) return null;
    const ok = better === "lower" ? now.value <= then : now.value >= then;
    return {
      ok, reading: `${fmt(now.value, unit, decimals)}, from ${fmt(then, unit, decimals)} a year earlier`, asOf: period(now.period),
      toMeet: `needs to get back ${better === "lower" ? "down" : "up"} to ${fmt(then, unit, decimals)}, where it was a year earlier`,
    };
  };
  // Reads a Budget series in its last two final-outcome years.
  const budgetRule = (pick: (b: Budget) => YearValue[], better: "lower" | "higher", unit: "%" | "AUD" = "%") => (): Reading | null => {
    if (!budget) return null;
    const pair = lastActuals(pick(budget));
    if (!pair) return null;
    const [prev, now] = pair;
    const ok = better === "lower" ? now.value <= prev.value : now.value >= prev.value;
    const show = (v: number) => (unit === "AUD" ? money(v * 1_000_000) : pc(v));
    return {
      ok, reading: `${show(now.value)} in ${now.year}, ${show(prev.value)} in ${prev.year}`, asOf: now.year,
      toMeet: `the next final outcome needs to be no ${better === "lower" ? "higher" : "lower"} than ${now.year}'s ${show(now.value)}`,
    };
  };

  const affordability: Spec[] = [
    {
      id: "real-wages", name: "Wages growing faster than prices", basis: "yardstick", href: "/economy#real-wages",
      rule: "Met when the Wage Price Index has grown at least as fast as the CPI over the past year. No published target; the yardstick is that a wage should not buy less than it did a year ago.",
      read: () => {
        const x = s("real-wages");
        if (!x) return null;
        const v = last(x);
        return { ok: v.value >= 0, reading: `real wages ${signed(v.value)} pts on a year earlier`, asOf: period(v.period),
          toMeet: `wage growth needs to catch up with prices: ${pts(-v.value)} more a year` };
      },
    },
    {
      id: "inflation", name: "Inflation inside the target band", basis: "published", href: "/economy#cpi",
      rule: `Met when annual CPI inflation is between ${INFLATION_TARGET.low}% and ${INFLATION_TARGET.high}%, the target in the Statement on the Conduct of Monetary Policy agreed between the Treasurer and the Reserve Bank.`,
      read: () => {
        const x = s("cpi");
        if (!x) return null;
        const v = last(x);
        const above = v.value > INFLATION_TARGET.high;
        return { ok: v.value >= INFLATION_TARGET.low && v.value <= INFLATION_TARGET.high, reading: `${pc(v.value)} on a year earlier`, asOf: period(v.period),
          toMeet: above ? `inflation needs to fall ${pts(v.value - INFLATION_TARGET.high)} to ${INFLATION_TARGET.high}%` : `inflation needs to rise ${pts(INFLATION_TARGET.low - v.value)} to ${INFLATION_TARGET.low}%` };
      },
    },
    {
      id: "rents", name: "Rents rising no faster than wages", basis: "yardstick", href: "/economy#cpi-rents",
      rule: "Met when CPI rents, read at the end of the latest wage quarter, have risen no faster over the year than the Wage Price Index. No published target.",
      read: () => {
        const rents = s("cpi-rents"), wages = s("wages");
        if (!rents || !wages) return null;
        const w = last(wages);
        const r = at(rents, quarterEnd(w.period));
        if (r === null) return null;
        return { ok: r <= w.value, reading: `rents ${pc(r)}, wages ${pc(w.value)}, both on a year earlier`, asOf: period(w.period),
          toMeet: `rent growth needs to slow by ${pts(r - w.value)} to match wages` };
      },
    },
    {
      id: "essentials", name: "Essentials rising no faster than prices overall", basis: "yardstick", href: "/economy#cpi-food",
      rule: "Met when none of groceries, electricity, gas and fuel has risen faster over the year than the headline CPI. No published target; these are the bills a household can't put off.",
      read: () => {
        const cpi = s("cpi");
        const parts = [["groceries", "cpi-food"], ["electricity", "cpi-electricity"], ["gas", "cpi-gas"], ["fuel", "cpi-fuel"]] as const;
        if (!cpi || parts.some(([, id]) => !s(id))) return null;
        const h = last(cpi);
        const readings = parts.map(([name, id]) => ({ name, value: at(s(id)!, h.period) }));
        if (readings.some((r) => r.value === null)) return null;
        const faster = readings.filter((r) => r.value! > h.value);
        return {
          ok: faster.length === 0,
          toMeet: `${faster.map((r) => r.name).join(" and ")} need${faster.length === 1 ? "s" : ""} to rise no faster than ${pc(h.value)}`,
          reading: `${faster.length} of 4 faster than the ${pc(h.value)} headline` + (faster.length ? `: ${faster.map((r) => `${r.name} ${pc(r.value!)}`).join(", ")}` : ""),
          asOf: period(h.period),
        };
      },
    },
    {
      id: "mortgage-rate", name: "New mortgage rate not rising", basis: "yardstick", href: "/economy#mortgage-rate",
      rule: "Met when the average rate on new variable owner-occupier loans is no higher than a year earlier. Set by lenders following the cash rate, not by the government; here because it is the largest bill most households pay.",
      read: yearOnYearRule("mortgage-rate", "lower", "%", 2),
    },
    {
      id: "household-debt", name: "Household debt not growing faster than income", basis: "yardstick", href: "/economy#household-debt-income",
      rule: "Met when household debt as a share of disposable income is no higher than a year earlier. No published target.",
      read: yearOnYearRule("household-debt-income", "lower"),
    },
    {
      id: "home-prices", name: "Home prices rising no faster than wages", basis: "yardstick", href: "/economy#dwelling-price",
      rule: "Met when the mean home price has risen over the year by no more than the Wage Price Index. No published target; it is the plainest test of whether homes are getting further out of reach.",
      read: () => {
        const price = s("dwelling-price"), wages = s("wages");
        if (!price || !wages) return null;
        const p = last(price), growth = yearOnYear(price).get(p.period), w = at(wages, p.period);
        if (growth === undefined || w === null) return null;
        return { ok: growth <= w, reading: `home prices ${pc(growth)}, wages ${pc(w)}, both on a year earlier (mean price ${money(p.value)})`, asOf: period(p.period),
          toMeet: `home price growth needs to slow by ${pts(growth - w)} to match wages` };
      },
    },
    {
      id: "credit-cards", name: "Credit card debt not growing in real terms", basis: "yardstick", href: "/economy#credit-card-debt",
      rule: "Met when interest-bearing credit card balances have grown over the year by no more than the CPI. No published target.",
      read: () => {
        const debt = s("credit-card-debt"), cpi = s("cpi");
        if (!debt || !cpi) return null;
        const d = last(debt), growth = yearOnYear(debt).get(d.period), p = at(cpi, d.period);
        if (growth === undefined || p === null) return null;
        return { ok: growth <= p, reading: `balances ${signed(growth)}%, prices ${pc(p)}, both on a year earlier`, asOf: period(d.period),
          toMeet: `balance growth needs to slow by ${pts(growth - p)} to match prices` };
      },
    },
  ];

  const housing: Spec[] = [
    {
      id: "accord", name: "Homes completed at the Housing Accord rate", basis: "published", href: "/economy#dwellings-completed",
      rule: `Met when dwellings completed over the latest four quarters reach ${ACCORD.perYear.toLocaleString("en-AU")}: the National Housing Accord's ${(ACCORD.homes / 1e6).toFixed(1)} million homes over ${ACCORD.years} years from 1 July 2024, spread evenly. The reading also shows the running total against the Accord since it began.`,
      read: () => {
        const x = s("dwellings-completed");
        if (!x) return null;
        const year = sumLast(x, 4);
        if (year === null) return null;
        const since = x.points.filter((p) => p.period >= ACCORD.from);
        const done = since.reduce((a, p) => a + p.value, 0), due = since.length * ACCORD.perQuarter;
        return {
          ok: year >= ACCORD.perYear,
          toMeet: `${Math.round(ACCORD.perYear - year).toLocaleString("en-AU")} more completions a year (${pct(ACCORD.perYear - year, year)}% more than now)`,
          reading: `${Math.round(year).toLocaleString("en-AU")} in the last four quarters; ${Math.round(done).toLocaleString("en-AU")} since July 2024 against ${due.toLocaleString("en-AU")} due by now (${pct(done, due)}%)`,
          asOf: period(last(x).period),
        };
      },
    },
    {
      id: "approvals", name: "Homes approved at the Housing Accord rate", basis: "published", href: "/economy#building-approvals",
      rule: `Met when dwellings approved over the latest twelve months reach ${ACCORD.perYear.toLocaleString("en-AU")}, the Accord's yearly rate. Approvals run ahead of completions, so this is the early warning for the indicator above.`,
      read: () => {
        const x = s("building-approvals");
        if (!x) return null;
        const year = sumLast(x, 12);
        if (year === null) return null;
        return { ok: year >= ACCORD.perYear, reading: `${Math.round(year).toLocaleString("en-AU")} approved in the last twelve months`, asOf: period(last(x).period),
          toMeet: `${Math.round(ACCORD.perYear - year).toLocaleString("en-AU")} more approvals a year` };
      },
    },
    {
      id: "housing-pressure", name: "Homes keeping up with population", basis: "yardstick", href: "/economy#housing-pressure",
      rule: "Met when new residents per new dwelling over the latest four quarters is 2.5 or fewer, the size of the average Australian household. Above that, people are arriving faster than homes are finished.",
      read: () => {
        const x = s("housing-pressure");
        if (!x) return null;
        const v = last(x);
        return { ok: v.value <= 2.5, reading: `${v.value.toFixed(1)} new residents per new dwelling`, asOf: period(v.period),
          toMeet: `needs to fall by ${(v.value - 2.5).toFixed(1)} to 2.5: more homes finished, or fewer arrivals` };
      },
    },
  ];

  const jobs: Spec[] = [
    {
      id: "gdp-per-capita", name: "Economy growing per person", basis: "yardstick", href: "/economy#gdp-per-capita",
      rule: "Met when real GDP per person grew in the latest quarter. Headline GDP can grow on population alone; per person is the test of living standards.",
      read: () => {
        const x = s("gdp-per-capita");
        if (!x) return null;
        const v = last(x);
        return { ok: v.value >= 0, reading: `${signed(v.value)}% on the previous quarter`, asOf: period(v.period),
          toMeet: "GDP per person needs to grow in the next quarter" };
      },
    },
    { id: "unemployment", name: "Unemployment not rising", basis: "yardstick", href: "/economy#unemployment", rule: "Met when the unemployment rate is no higher than a year earlier. The government has no numeric full-employment target.", read: yearOnYearRule("unemployment", "lower") },
    { id: "participation", name: "Participation not falling", basis: "yardstick", href: "/economy#participation", rule: "Met when the participation rate is at least what it was a year earlier. A falling unemployment rate can hide people giving up looking.", read: yearOnYearRule("participation", "higher") },
    { id: "underemployment", name: "Underemployment not rising", basis: "yardstick", href: "/economy#underemployment", rule: "Met when the share of workers wanting more hours is no higher than a year earlier.", read: yearOnYearRule("underemployment", "lower") },
    { id: "productivity", name: "Productivity growing", basis: "yardstick", href: "/economy#productivity", rule: "Met when GDP per hour worked is at least what it was a year earlier. Productivity is what pays for real wage growth over time.", read: yearOnYearRule("productivity", "higher", "index") },
  ];

  const fiscal: Spec[] = [
    {
      id: "gross-debt", name: "Gross debt falling as a share of GDP", basis: "published", href: "/economy#gross-debt-share-gdp",
      rule: "Met when government securities on issue, as a share of the last four quarters of GDP, are lower than a year earlier. The Budget's fiscal strategy commits to gross debt as a share of GDP being on a downward trajectory.",
      read: yearOnYearRule("gross-debt-share-gdp", "lower"),
    },
    { id: "balance", name: "Budget balance improving", basis: "yardstick", href: "/budget", rule: "Met when the underlying cash balance as a share of GDP in the latest final-outcome year was at least the year before's. Estimates are not read; only years with a final outcome.", read: budgetRule((b) => b.balanceShare, "higher") },
    { id: "net-debt", name: "Net debt not rising as a share of GDP", basis: "yardstick", href: "/budget", rule: "Met when net debt as a share of GDP in the latest final-outcome year was no higher than the year before's.", read: budgetRule((b) => b.netDebtShare, "lower") },
    { id: "interest", name: "Interest bill not rising as a share of GDP", basis: "yardstick", href: "/budget", rule: "Met when net interest payments as a share of GDP in the latest final-outcome year were no higher than the year before's.", read: budgetRule((b) => b.netInterestShare, "lower") },
    {
      id: "payments", name: "Real spending growth within 2% a year", basis: "yardstick", href: "/budget",
      rule: `Met when payments grew by no more than ${REAL_PAYMENTS_GROWTH_LIMIT}% in real terms in the latest final-outcome year. The fiscal strategy used that ceiling from 2014 to 2022; the current strategy gives no number, so the old one is kept as the yardstick.`,
      read: () => {
        if (!budget) return null;
        const pair = lastActuals(budget.paymentsRealGrowth);
        if (!pair) return null;
        const [prev, now] = pair;
        return { ok: now.value <= REAL_PAYMENTS_GROWTH_LIMIT, reading: `${signed(now.value)}% in ${now.year}, ${signed(prev.value)}% in ${prev.year}`, asOf: now.year,
          toMeet: `real payments growth needs to be ${pts(now.value - REAL_PAYMENTS_GROWTH_LIMIT)} lower, at or under ${REAL_PAYMENTS_GROWTH_LIMIT}%` };
      },
    },
    { id: "tax-take", name: "Tax take not rising as a share of GDP", basis: "yardstick", href: "/revenue", rule: "Met when receipts as a share of GDP in the latest final-outcome year were no higher than the year before's. The previous government's 23.9% cap was dropped in 2022, so direction is the yardstick.", read: budgetRule((b) => b.receiptsShare, "lower") },
  ];

  const investment: Spec[] = [
    { id: "public-investment", name: "Public investment holding up as a share of GDP", basis: "yardstick", href: "/economy#public-investment-share", rule: "Met when public sector capital formation as a share of GDP, all levels of government, is at least what it was a year earlier. No published target.", read: yearOnYearRule("public-investment-share", "higher", "%", 2) },
    { id: "capital", name: "Commonwealth net capital investment not falling", basis: "yardstick", href: "/budget", rule: "Met when the Commonwealth's net capital investment as a share of GDP in the latest final-outcome year was at least the year before's. Net of depreciation, so it shows whether the asset base is growing.", read: budgetRule((b) => b.netCapitalInvestmentShare, "higher") },
  ];

  // Response: does planned spending follow the pressure? The allocation is the latest Budget's expenses by
  // function, the Budget year against the Budget's own estimate for the year before. Both are estimates, which
  // is the one place the scorecard reads them: an allocation is a plan by definition. The pressure is the latest
  // twelve-month growth in the figure that measures the problem. Met when the plan grows at least as fast.
  const allocation = (fn: RegExp) => {
    if (!budget) return null;
    const f = budget.functions.find((x) => fn.test(x.name));
    const now = f?.series.find((p) => p.year === budget.budgetYear), prev = f?.series.find((p) => p.year === previousYear(budget.budgetYear));
    if (!f || !now || !prev || !prev.value) return null;
    return { name: f.name, now, prev, growth: (now.value / prev.value - 1) * 100 };
  };
  type Pressure = { label: string; growth: number; asOf: string };
  // A monthly or quarterly series already expressed as growth on a year earlier.
  const rate = (id: string, label: string) => (): Pressure | null => { const x = s(id); if (!x) return null; const v = last(x); return { label, growth: v.value, asOf: period(v.period) }; };
  // A yearly count: growth of the latest year on the one before.
  const yearly = (id: string, label: string) => (): Pressure | null => {
    const x = s(id); if (!x || x.points.length < 2) return null;
    const [prev, now] = x.points.slice(-2);
    if (!prev.value) return null;
    return { label: `${label}, ${period(now.period)} on ${period(prev.period)}`, growth: (now.value / prev.value - 1) * 100, asOf: period(now.period) };
  };
  // The fastest-rising of several rates.
  const fastest = (parts: [string, string][]) => (): Pressure | null => {
    const read = parts.map(([id, label]) => rate(id, label)());
    if (read.some((r) => !r)) return null;
    return read.reduce((a, b) => (b!.growth > a!.growth ? b : a))!;
  };
  const responseRule = (fn: RegExp, pressure: () => Pressure | null) => (): Reading | null => {
    const a = allocation(fn), p = pressure();
    if (!a || !p) return null;
    const gap = p.growth - a.growth;
    return {
      ok: a.growth >= p.growth,
      reading: `${a.name} ${signed(a.growth)}% (${money(a.prev.value * 1e6)} in ${a.prev.year} to ${money(a.now.value * 1e6)} in ${a.now.year}); ${p.label} ${signed(p.growth)}%`,
      asOf: `${a.now.year} Budget; ${p.asOf}`,
      toMeet: `${a.name} needs ${pts(gap)} more growth: about ${money(a.prev.value * 1e6 * gap / 100)} more in ${a.now.year}`,
    };
  };
  const ESTIMATES = "The allocation is the latest Budget's expenses by function: the Budget year against the Budget's own estimate for the year before, so both are estimates, unlike the other Budget rules. No published target.";
  const response: Spec[] = [
    {
      id: "response-housing", name: "Housing spending keeping pace with rents", basis: "yardstick", href: "/budget",
      rule: `Met when planned spending on housing and community amenities grows at least as fast as rents (CPI rents over the latest twelve months). ${ESTIMATES}`,
      read: responseRule(/^housing/i, rate("cpi-rents", "rents")),
    },
    {
      id: "response-cost-of-living", name: "Welfare spending keeping pace with prices", basis: "yardstick", href: "/budget",
      rule: `Met when planned spending on social security and welfare grows at least as fast as the CPI over the latest twelve months, so payments are not shrinking in real terms. ${ESTIMATES}`,
      read: responseRule(/^social security/i, rate("cpi", "prices")),
    },
    {
      id: "response-homelessness", name: "Housing spending keeping pace with homelessness", basis: "yardstick", href: "/crime#homelessness",
      rule: `Met when planned spending on housing and community amenities grows at least as fast as the number of people helped by specialist homelessness services (AIHW, latest financial year on the one before). ${ESTIMATES}`,
      read: responseRule(/^housing/i, yearly("homelessness:shs-clients:AUS", "people helped by homelessness services")),
    },
    {
      id: "response-crime", name: "Public order spending keeping pace with offending", basis: "yardstick", href: "/crime",
      rule: `Met when planned spending on public order and safety grows at least as fast as offenders per 100,000 people (ABS Recorded Crime, latest financial year on the one before). The ABS publishes no national total of victims across offences, so the offender rate is the pressure figure. ${ESTIMATES}`,
      read: responseRule(/^public order/i, yearly("crime:offender-rate:AUS:total", "offenders per 100,000")),
    },
    {
      id: "response-energy", name: "Energy spending keeping pace with power and fuel bills", basis: "yardstick", href: "/budget",
      rule: `Met when planned spending on fuel and energy grows at least as fast as the fastest-rising of electricity, gas and automotive fuel in the CPI over the latest twelve months. ${ESTIMATES}`,
      read: responseRule(/^fuel and energy/i, fastest([["cpi-electricity", "electricity"], ["cpi-gas", "gas"], ["cpi-fuel", "fuel"]])),
    },
  ];

  const procurement: Spec[] = [
    {
      id: "late", name: "Contracts reported on time", basis: "yardstick", href: "/spending/90",
      rule: `Met when no more than ${LATE_SHARE_LIMIT}% of contracts in the last 90 days were published after the 42-day deadline in the Commonwealth Procurement Rules. The rules require all of them on time; ${LATE_SHARE_LIMIT}% is our allowance. "Late" is measured from the contract start date because the notice repeats the publish date as the signing date.`,
      read: () => {
        if (!contracts || !contracts.knownStartCount) return null;
        const share = (contracts.lateCount / contracts.knownStartCount) * 100;
        return { ok: share <= LATE_SHARE_LIMIT, reading: `${pc(share)} late: ${contracts.lateCount.toLocaleString("en-AU")} of ${contracts.knownStartCount.toLocaleString("en-AU")} with a known start date`, asOf: `90 days to ${contracts.to.toISOString().slice(0, 10)}`,
          toMeet: `${Math.ceil(contracts.lateCount - (LATE_SHARE_LIMIT / 100) * contracts.knownStartCount).toLocaleString("en-AU")} fewer late notices in 90 days` };
      },
    },
    {
      id: "limited", name: "Most contract value through open competition", basis: "yardstick", href: "/spending/90",
      rule: `Met when no more than ${LIMITED_SHARE_LIMIT}% of contract value in the last 90 days was awarded by limited tender. The Procurement Rules make open tender the default but set no share; ${LIMITED_SHARE_LIMIT}% is our yardstick until a year of stored history lets this compare with the same window a year earlier.`,
      read: () => {
        if (!contracts || !contracts.totalValue) return null;
        const share = (contracts.limitedValue / contracts.totalValue) * 100;
        return { ok: share <= LIMITED_SHARE_LIMIT, reading: `${pc(share)} of ${money(contracts.totalValue)} by limited tender`, asOf: `90 days to ${contracts.to.toISOString().slice(0, 10)}`,
          toMeet: `${money(contracts.limitedValue - (LIMITED_SHARE_LIMIT / 100) * contracts.totalValue)} less by limited tender in 90 days, put to open tender instead` };
      },
    },
  ];

  const groups: { id: string; name: string; question: string; specs: Spec[] }[] = [
    { id: "affordability", name: "Affordability", question: "Is a pay packet going further than it did a year ago?", specs: affordability },
    { id: "housing", name: "Housing supply", question: "Are homes being built at the rate the government promised?", specs: housing },
    { id: "jobs", name: "Jobs and growth", question: "Is the economy growing per person, with more people in work?", specs: jobs },
    { id: "fiscal", name: "Budget and debt", question: "Is the budget position improving, as the fiscal strategy says it should?", specs: fiscal },
    { id: "investment", name: "Investment", question: "Is the public sector building its asset base, not running it down?", specs: investment },
    { id: "procurement", name: "Procurement", question: "Is public money spent through open competition and reported on time?", specs: procurement },
    { id: "response", name: "Response", question: "Is planned spending growing at least as fast as the pressure it answers?", specs: response },
  ];

  const missing: string[] = [];
  const pillars: Pillar[] = groups.map((g) => {
    const kpis: Kpi[] = g.specs.map(({ read, ...spec }) => {
      let r: Reading | null = null;
      try { r = read(); } catch { r = null; }
      if (!r) missing.push(spec.name);
      return r
        ? { ...spec, status: r.ok ? "met" : "missed", reading: r.reading, asOf: r.asOf, toMeet: r.ok ? null : r.toMeet ?? null }
        : { ...spec, status: "no-data", reading: "Source didn’t answer", asOf: null, toMeet: null };
    });
    const met = kpis.filter((k) => k.status === "met").length, scored = kpis.filter((k) => k.status !== "no-data").length;
    return { id: g.id, name: g.name, question: g.question, kpis, met, scored, score: score(met, scored) };
  });

  const total = pillars.reduce((a, p) => a + p.kpis.length, 0);
  const met = pillars.reduce((a, p) => a + p.met, 0), scored = pillars.reduce((a, p) => a + p.scored, 0);
  const targets = pillars.flatMap((p) => p.kpis).filter((k) => k.basis === "published" && k.status !== "no-data");
  return {
    pillars,
    met,
    scored,
    total,
    missing,
    score: score(met, scored),
    targetsScore: score(targets.filter((k) => k.status === "met").length, targets.length),
    method:
      `${total} indicators in ${WORDS[groups.length] ?? groups.length} groups, each a fixed rule over an official figure, printed next to its result. ` +
      "Where the government has published a target the rule is that target; otherwise it is a stated yardstick, and the two are marked apart. " +
      "The score out of 100 is the share of readable rules that are met, every rule counting the same. Nothing else goes into it: no weights, no probability, " +
      "and an indicator that didn't load is left out of the count rather than assumed either way. Budget rules read final outcomes only, never estimates, " +
      "except the Response group, which reads the latest Budget's planned spending by function because an allocation is a plan.",
  };
}
