// Australian Bureau of Statistics Data API (SDMX, no key, CC BY 4.0).
// Docs: https://www.abs.gov.au/about/data-services/application-programming-interfaces-apis/data-api-user-guide
import type { Point, Series } from "./types";

const BASE = "https://data.api.abs.gov.au/rest/data";

type AbsSpec = Omit<Series, "points" | "source" | "sourceUrl"> & {
  flow: string; // dataflow id and version, e.g. "ABS,LF,1.0.0"
  key: string; // SDMX series key, dimensions separated by dots
  from: string; // startPeriod
  table: string; // ABS publication name
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
    const value = Number(cells[v]);
    if (cells[t] && cells[v] !== "" && Number.isFinite(value)) points.push({ period: cells[t], value });
  }
  // The API returns rows in no particular order.
  points.sort((a, b) => a.period.localeCompare(b.period));
  if (points.length === 0) throw new Error(`ABS returned no observations for ${spec.id}`);

  const { flow, key, from, table, ...rest } = spec;
  return { ...rest, points, source: `ABS, ${table}`, sourceUrl: url + "&format=csv" };
}
