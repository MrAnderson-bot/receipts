import type { Metadata } from "next";
import { getIndicators } from "@/lib/economy";
import { tryGetSummary } from "@/lib/sources/austender";
import { ABS_SERIES } from "@/lib/sources/abs";
import { RBA_SERIES } from "@/lib/sources/rba";
import { tryGetGrants } from "@/lib/sources/grantconnect";
import { tryGetRevenue } from "@/lib/sources/treasury";
import { tryGetTaxByLevel } from "@/lib/sources/abs-tax";
import { tryGetBudget } from "@/lib/sources/budget";
import { tryGetTransparency } from "@/lib/sources/ato-transparency";
import { tryGetState, STATE_CODES, NOT_CONNECTED as STATES_NOT_CONNECTED } from "@/lib/sources/states";
import { tryGetMigration } from "@/lib/sources/migration";
import { tryGetAps } from "@/lib/sources/apsc";
import { getStore, type DbStats } from "@/lib/db";
import { num } from "@/lib/format";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Sources" };

type Row = { name: string; url: string; gives: string; licence: string; ok: boolean; status: string };

// Feeds that are wanted but can't be pulled automatically yet, and why.
const NOT_CONNECTED = [
  {
    name: "Final Budget Outcome for the latest year, as its own document (Treasury)",
    url: "https://budget.gov.au/content/fbo/index.htm",
    why: "Published only as PDF and Word. Its headline figures do reach this site, because the next Budget’s historical tables carry them as final outcomes.",
  },
  {
    name: "Earnings of ASX-listed companies",
    url: "https://www.asx.com.au/markets/trade-our-cash-market/announcements",
    why: "Listed companies report earnings as PDF announcements. There is no open dataset, the ASX’s own data is licensed commercially, and the free feeds people use are unofficial and barred from republication. The Tax Office’s transparency list on the companies page is the open alternative.",
  },
  ...STATES_NOT_CONNECTED,
];

export default async function Page() {
  const [indicators, spending, grants, revenue, levels, budget, companies, migration, aps, ...states] = await Promise.all([
    getIndicators(), tryGetSummary(7), tryGetGrants(7), tryGetRevenue(), tryGetTaxByLevel(),
    tryGetBudget(), tryGetTransparency(), tryGetMigration(), tryGetAps(), ...STATE_CODES.map((c) => tryGetState(c)),
  ]);
  const ags = indicators.find((r) => r.id === "ags-on-issue");
  const okIds = new Set(indicators.filter((r) => r.series).map((r) => r.id));
  const count = (ids: string[]) => `${ids.filter((id) => okIds.has(id)).length} of ${ids.length} series answering`;
  const absIds = ABS_SERIES.map((s) => s.id);
  const rbaIds = RBA_SERIES.map((s) => s.id);

  const rows: Row[] = [
    {
      name: "Australian Bureau of Statistics, Data API",
      url: "https://data.api.abs.gov.au",
      gives: ABS_SERIES.map((s) => s.label).join(", "),
      licence: "CC BY 4.0",
      ok: absIds.some((id) => okIds.has(id)),
      status: count(absIds),
    },
    {
      name: "Reserve Bank of Australia, statistical tables",
      url: "https://www.rba.gov.au/statistics/tables/",
      gives: RBA_SERIES.map((s) => s.label).join(", "),
      licence: "RBA copyright, free use with attribution",
      ok: rbaIds.some((id) => okIds.has(id)),
      status: count(rbaIds),
    },
    {
      name: "AusTender, OCDS API",
      url: "https://github.com/austender/austender-ocds-api",
      gives: "contract notices: agency, supplier, value, category, procurement method, dates",
      licence: "CC BY 3.0 AU",
      ok: !!spending.data,
      status: spending.data ? `${num(spending.data.contracts.length)} contracts in the last 7 days` : `Not answering. ${spending.error}`,
    },
    {
      name: "GrantConnect, Grant Award Published report",
      url: "https://www.grants.gov.au/reports/gapublishedform",
      gives: "grant awards: agency, recipient, value, category, selection process, dates, delivery location",
      licence: "CC BY 3.0 AU",
      ok: !!grants.data,
      status: grants.data ? `${num(grants.data.count)} grants in the last 7 days` : `Not answering. ${grants.error}`,
    },
    {
      name: "Treasury, Budget Paper No. 1, Statement 5",
      url: "https://budget.gov.au/content/bp1/index.htm",
      gives: "Commonwealth receipts by source, with Budget estimates, and receipts as a share of GDP",
      licence: "CC BY 4.0",
      ok: !!revenue.data,
      status: revenue.data ? `Final figures to ${revenue.data.latestActual}` : `Not answering. ${revenue.error}`,
    },
    {
      name: "ABS, Taxation Revenue, Australia",
      url: "https://www.abs.gov.au/statistics/economy/government/taxation-revenue-australia/latest-release",
      gives: "taxes collected by the Commonwealth and by state and local governments",
      licence: "CC BY 4.0",
      ok: !!levels.data,
      status: levels.data ? `Figures to ${levels.data.latest}` : `Not answering. ${levels.error}`,
    },
    {
      name: "Department of Finance, Budget tables on data.gov.au",
      url: budget.data?.datasetUrl ?? "https://data.gov.au",
      gives: "expenses by function, receipts, payments and balance since 1970-71, net debt, every program’s expenses",
      licence: "CC BY 4.0",
      ok: !!budget.data,
      status: budget.data ? `${budget.data.budgetYear} Budget, outcomes to ${budget.data.latestActual}` : `Not answering. ${budget.error}`,
    },
    {
      name: "Australian Taxation Office, Corporate Tax Transparency",
      url: "https://data.gov.au/data/dataset/corporate-transparency",
      gives: "every large company’s total income, taxable income and tax payable, Australian and foreign-owned",
      licence: "CC BY 3.0 AU",
      ok: !!companies.data,
      status: companies.data ? `${num(companies.data.totals.entities)} companies, income year ${companies.data.year}` : `Not answering. ${companies.error}`,
    },
    {
      name: "Department of Home Affairs, visa statistics on data.gov.au",
      url: "https://data.gov.au/data/group/immigration",
      gives: "temporary visa holders by category and date; skilled and working holiday visas granted by year; permanent Migration Program outcomes; the Australian Migration Statistics package (program history since 1984-85, temporary visas granted, NOM by visa category, citizenship by country)",
      licence: "CC BY 3.0 AU",
      ok: [migration.tempHolders, migration.skilled, migration.whm, migration.permanent, migration.package].some((p) => p.data),
      status: (() => {
        const parts = { "temporary visa holders": migration.tempHolders, "skilled grants": migration.skilled, "working holiday grants": migration.whm, "permanent program": migration.permanent, "statistics package": migration.package };
        const down = Object.entries(parts).filter(([, p]) => !p.data);
        const t = migration.tempHolders.data;
        return `${Object.keys(parts).length - down.length} of ${Object.keys(parts).length} files read${t ? `, holders at ${t.latest.date}` : ""}${down.length ? `. Not answering: ${down.map(([n, p]) => `${n} (${p.error})`).join("; ")}` : ""}`;
      })(),
    },
    {
      name: "ABS, Overseas Migration",
      url: "https://www.abs.gov.au/statistics/people/population/overseas-migration",
      gives: "net overseas migration, long-term arrivals and departures, by financial year",
      licence: "CC BY 4.0",
      ok: !!migration.nom.data,
      status: migration.nom.data ? `To ${migration.nom.data.latest.year.replace(/^FY/, "")}` : `Not answering. ${migration.nom.error}`,
    },
    {
      name: "Australian Public Service Commission, APS Employment Database on data.gov.au",
      url: aps.data?.latest.datasetUrl ?? "https://data.gov.au/data/dataset/?q=APS+Employment+Data",
      gives: "APS headcount by agency, gender and classification level at each half-yearly snapshot, and totals by gender back to 2006",
      licence: "CC BY 3.0 AU",
      ok: !!aps.data,
      status: aps.data ? `${aps.data.releases.length} releases read, latest ${aps.data.latest.label}, ${num(aps.data.latest.total)} employees` : `Not answering. ${aps.error}`,
    },
    {
      name: "Australian Office of Financial Management, data hub",
      url: "https://www.aofm.gov.au/data-hub",
      gives: "Australian Government Securities on issue, face value, monthly since 2010",
      licence: "CC BY 4.0",
      ok: !!ags?.series,
      status: ags?.series ? `To ${ags.series.points[ags.series.points.length - 1].period}` : `Not answering. ${ags?.error ?? "not loaded"}`,
    },
    ...states.map((s, i) => ({
      name: s.data ? `${s.data.name}: ${s.data.sourceName}` : `${STATE_CODES[i]} contracts`,
      url: s.data?.sourceUrl ?? "https://data.gov.au",
      gives: s.data?.noun === "invoices" ? "invoices of $25,000 and over: agency, supplier, amount, date" : "state government contracts: agency, supplier, value, award date",
      licence: s.data?.licence ?? "CC BY 4.0",
      ok: !!s.data,
      status: s.data
        ? `${num(s.data.count)} ${s.data.noun}, ${s.data.period.toLowerCase()}, ${num(s.data.filesRead)} ${s.data.filesRead === 1 ? "file" : "files"} read${s.data.filesSkipped.length ? `, ${num(s.data.filesSkipped.length)} left out` : ""}`
        : `Not answering. ${s.error}`,
    })),
  ];
  const failed = indicators.filter((r) => !r.series);
  // The database is a local file, so a deployed copy of the site has nothing to show here.
  let db: DbStats | null = null;
  try { db = await getStore().stats(); } catch { db = null; }

  return (
    <>
      <section className="hero compact">
        <h1>Sources</h1>
        <p>
          Every feed behind this site, checked when this page was built. Each one is a separate
          module that returns the same shape of data, so new sources slot in without touching the pages.
        </p>
      </section>

      <section>
        <h2>Connected</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">What it gives</th>
                <th scope="col">Licence</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td><a href={r.url} target="_blank" rel="noreferrer">{r.name}</a></td>
                  <td>{r.gives}</td>
                  <td>{r.licence}</td>
                  <td>
                    <span className={r.ok ? "tag limited" : "tag late"}>{r.ok ? "Live" : "Down"}</span>
                    <div className="desc">{r.status}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {failed.length > 0 && (
          <p className="note">
            Not answering right now: {failed.map((f) => `${f.label} (${f.error})`).join("; ")}
          </p>
        )}
      </section>

      {db && (
        <section>
          <h2>Stored history</h2>
          <p className="note">
            A daily snapshot of every feed is kept in a local database ({db.location}), so figures can be compared over time and
            revisions by the publisher stay visible.
          </p>
          <div className="figures four">
            <div><strong>{num(db.series)}</strong><span>time series</span></div>
            <div><strong>{num(db.observations)}</strong><span>observations, including superseded revisions</span></div>
            <div><strong>{num(db.snapshots)}</strong><span>dated snapshots of contracts, grants, states and budgets</span></div>
            <div><strong>{num(db.companies)}</strong><span>companies from the Tax Office list, keyed by ABN</span></div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            Contract notices stored one row each: {num(db.contracts)}, of which {num(db.noticesRead)} have had their public page read
            for the fields the API leaves out (execution date, Australian business flag, confidentiality, extension options).
            APS headcount cells stored one row each: {num(db.apsRows)} across {num(db.apsReleases)} snapshots.
          </p>
          <p className="note" style={{ marginTop: 12 }}>
            {db.lastRun
              ? `Last snapshot ${new Date(db.lastRun.startedAt).toLocaleString("en-AU")}: ${db.lastRun.saved} sources saved${db.lastRun.failed ? `, ${db.lastRun.failed} failed` : ""}.`
              : "No snapshot has been taken yet. Run npm run snapshot."}
          </p>
        </section>
      )}

      <section>
        <h2>Not connected yet</h2>
        <ul className="plain">
          {NOT_CONNECTED.map((n) => (
            <li key={n.name}>
              <a href={n.url} target="_blank" rel="noreferrer">{n.name}</a>
              <p>{n.why}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer>
        Economy and grant figures refresh at most every six hours, contract figures every hour and revenue figures daily. The code
        for every feed is in <code>lib/sources</code>.
      </footer>
    </>
  );
}
