// Australian Bureau of Statistics Data API (SDMX, no key, CC BY 4.0).
// Docs: https://www.abs.gov.au/about/data-services/application-programming-interfaces-apis/data-api-user-guide
import type { Point, Series } from "./types";

const BASE = "https://data.api.abs.gov.au/rest/data";

type AbsSpec = Omit<Series, "points" | "source" | "sourceUrl"> & {
  flow: string; // dataflow id and version, e.g. "ABS,LF,1.0.0"
  key: string; // SDMX series key, dimensions separated by dots
  from: string; // startPeriod
  table: string; // ABS publication name
  multiply?: number; // when the ABS publishes in thousands, so figures are stored in ones
};

export const ABS_SERIES: AbsSpec[] = [
  {
    id: "gdp-growth", label: "GDP growth", unit: "%", frequency: "quarterly",
    note: "Real GDP, change on the previous quarter, seasonally adjusted.",
    flow: "ABS,ANA_AGG,1.0.0", key: "M2.GPM.20.AUS.Q", from: "2016", table: "National Accounts",
  },
  {
    id: "gdp-per-capita", label: "GDP per person growth", unit: "%", frequency: "quarterly",
    note: "Real GDP per capita, change on the previous quarter, seasonally adjusted.",
    flow: "ABS,ANA_AGG,1.0.0", key: "M2.GPM_PCA.20.AUS.Q", from: "2016", table: "National Accounts",
  },
  {
    id: "cpi", label: "Inflation", unit: "%", frequency: "monthly",
    note: "Consumer Price Index, all groups, change on the same month a year earlier. The complete monthly CPI starts in April 2025.",
    flow: "ABS,CPI,2.0.0", key: "3.10001.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  {
    id: "unemployment", label: "Unemployment rate", unit: "%", frequency: "monthly",
    note: "Unemployed people as a share of the labour force, seasonally adjusted.",
    flow: "ABS,LF,1.0.0", key: "M13.3.1599.20.AUS.M", from: "2016", table: "Labour Force",
  },
  {
    id: "wages", label: "Wage growth", unit: "%", frequency: "quarterly",
    note: "Wage Price Index, hourly rates excluding bonuses, change on the same quarter a year earlier, seasonally adjusted.",
    flow: "ABS,WPI,1.2.0", key: "3.THRPEB.7.TOT.20.AUS.Q", from: "2016", table: "Wage Price Index",
  },
  {
    id: "household-spending", label: "Household spending growth", unit: "%", frequency: "monthly",
    note: "Monthly Household Spending Indicator, total, current prices, change on a year earlier, seasonally adjusted.",
    flow: "ABS,HSI_M,1.6.0", key: "9.TOT.CUR.20.AUS.M", from: "2016", table: "Monthly Household Spending Indicator",
  },
  {
    id: "saving-ratio", label: "Household saving ratio", unit: "%", frequency: "quarterly",
    note: "Share of household disposable income that is saved, seasonally adjusted.",
    flow: "ABS,ANA_AGG,1.0.0", key: "M7.HSR.20.AUS.Q", from: "2016", table: "National Accounts",
  },
  {
    id: "terms-of-trade", label: "Terms of trade", unit: "index", frequency: "quarterly",
    note: "Export prices relative to import prices, index, seasonally adjusted.",
    flow: "ABS,ANA_AGG,1.0.0", key: "M5.TTR.20.AUS.Q", from: "2016", table: "National Accounts",
  },
  {
    id: "company-profits", label: "Company profits growth", unit: "%", frequency: "quarterly",
    note: "Company gross operating profits, all industries, change on the previous quarter, seasonally adjusted.",
    flow: "ABS,QBIS,1.0.0", key: "M8.CUR.TOT.TOT.20.AUS.Q", from: "2016", table: "Business Indicators",
  },
  {
    id: "population", label: "Population", unit: "people", frequency: "quarterly", decimals: 2,
    note: "Estimated resident population, all ages.",
    flow: "ABS,ERP_Q,1.0.0", key: "1.3.TOT.AUS.Q", from: "2016", table: "National, state and territory population",
  },
  {
    id: "population-change", label: "Population growth", unit: "people", frequency: "quarterly", decimals: 0,
    note: "People added to the resident population in the quarter: births minus deaths, plus net overseas migration.",
    flow: "ABS,ERP_COMP_Q,1.0.0", key: "13.AUS.Q", from: "2016", table: "National, state and territory population", multiply: 1000,
  },
  {
    id: "births", label: "Births", unit: "number", frequency: "quarterly", decimals: 0,
    note: "Babies born in Australia in the quarter, as counted for the population estimates.",
    flow: "ABS,ERP_COMP_Q,1.0.0", key: "1.AUS.Q", from: "2016", table: "National, state and territory population", multiply: 1000,
  },
  // Cost of living: the parts of the CPI a household feels first. Same measure as the headline: change on a year earlier.
  {
    id: "cpi-rents", label: "Rent inflation", unit: "%", frequency: "monthly",
    note: "CPI rents, change on the same month a year earlier. Covers rents actually paid, not asking rents.",
    flow: "ABS,CPI,2.0.0", key: "3.30014.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  {
    id: "cpi-electricity", label: "Electricity inflation", unit: "%", frequency: "monthly",
    note: "CPI electricity, change on the same month a year earlier. Government bill rebates show up here as falls when they start and jumps when they end.",
    flow: "ABS,CPI,2.0.0", key: "3.40055.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  {
    id: "cpi-gas", label: "Gas inflation", unit: "%", frequency: "monthly",
    note: "CPI gas and other household fuels, change on the same month a year earlier.",
    flow: "ABS,CPI,2.0.0", key: "3.115524.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  {
    id: "cpi-food", label: "Grocery inflation", unit: "%", frequency: "monthly",
    note: "CPI food and non-alcoholic beverages, change on the same month a year earlier. Monthly figures start in April 2025.",
    flow: "ABS,CPI,2.0.0", key: "3.20001.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  {
    id: "cpi-fuel", label: "Fuel inflation", unit: "%", frequency: "monthly",
    note: "CPI automotive fuel, change on the same month a year earlier.",
    flow: "ABS,CPI,2.0.0", key: "3.40081.10.50.M", from: "2016", table: "Consumer Price Index",
  },
  // Housing supply.
  {
    id: "building-approvals", label: "Dwellings approved", unit: "number", frequency: "monthly", decimals: 0,
    note: "New dwellings approved for construction in the month, all sectors, original figures. The ABS publishes no seasonally adjusted national total in this table.",
    flow: "ABS,BA_GCCSA,1.0.0", key: "1.1.9.1.100.10.AUS.M", from: "2016", table: "Building Approvals",
  },
  {
    id: "dwellings-completed", label: "Dwellings completed", unit: "number", frequency: "quarterly", decimals: 0,
    note: "New dwellings finished in the quarter, all sectors, seasonally adjusted.",
    flow: "ABS,BUILDING_ACTIVITY,1.0.0", key: "M7.AUS.CUR.1.9.100.20.Q", from: "2016", table: "Building Activity",
  },
];

export async function fetchAbs(spec: AbsSpec): Promise<Series> {
  const url = `${BASE}/${spec.flow}/${spec.key}?startPeriod=${spec.from}`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.sdmx.data+csv" },
    next: { revalidate: 21_600 }, // ABS releases land at 11:30am; six hours is plenty
  });
  if (!res.ok) throw new Error(`ABS returned ${res.status} for ${spec.flow}/${spec.key}`);

  const lines = (await res.text()).trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const t = head.indexOf("TIME_PERIOD");
  const v = head.indexOf("OBS_VALUE");
  if (t < 0 || v < 0) throw new Error(`ABS response for ${spec.id} has no TIME_PERIOD/OBS_VALUE columns`);

  const points: Point[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const value = Number(cells[v]) * (spec.multiply ?? 1);
    if (cells[t] && cells[v] !== "" && Number.isFinite(value)) points.push({ period: cells[t], value });
  }
  // The API returns rows in no particular order.
  points.sort((a, b) => a.period.localeCompare(b.period));
  if (points.length === 0) throw new Error(`ABS returned no observations for ${spec.id}`);

  const { flow, key, from, table, multiply, ...rest } = spec;
  return { ...rest, points, source: `ABS, ${table}`, sourceUrl: url + "&format=csv" };
}
