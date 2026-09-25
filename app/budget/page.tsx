import type { Metadata } from "next";
import { tryGetBudget } from "@/lib/sources/budget";
import { tryGetAssetSales } from "@/lib/sources/finance-sales";
import type { YearValue } from "@/lib/sources/treasury";
import type { Series } from "@/lib/sources/types";
import { tryGetAgs } from "@/lib/sources/aofm";
import { money, num, pct, period } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Budget" };

const M = 1_000_000; // the Budget tables are in $ million
const at = (s: YearValue[], year: string) => s.find((p) => p.year === year)?.value ?? 0;
const signedMoney = (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

export default async function Page() {
  const [{ data: b, error }, sales, ags] = await Promise.all([tryGetBudget(), tryGetAssetSales(), tryGetAgs()]);
  const agsLatest = ags.data ? ags.data.points[ags.data.points.length - 1] : null;
  if (!b) {
    return (
      <section className="error">
        <h1>The Budget tables didn’t load.</h1>
        <p>{error}</p>
      </section>
    );
  }

  const year = b.latestActual;
  const balance = at(b.balance, year);
  const estimates = b.balance.filter((p) => p.estimate);
  const total = at(b.totalExpenses, b.budgetYear);
  const src = (label: string) => <p className="src"><a href={b.datasetUrl} target="_blank" rel="noreferrer">Department of Finance, {label}</a></p>;
  // Charts use final outcomes only; estimates are listed in the table.
  const series = (id: string, label: string, unit: Series["unit"], values: YearValue[], scale: number): Series => ({
    id, label, unit, frequency: "yearly", decimals: 1, note: "", source: "Department of Finance", sourceUrl: b.datasetUrl,
    points: values.filter((v) => !v.estimate).map((v) => ({ period: `FY${v.year}`, value: v.value * scale })),
  });

  return (
    <>
      <section className="hero">
        <h1>
          <span className="big">{money(Math.abs(balance) * M)}</span>{" "}
          {balance < 0 ? "more went out than came in" : "more came in than went out"} in {year}.
        </h1>
        <p>
          The Commonwealth received {money(at(b.receipts, year) * M)} and paid out {money(at(b.payments, year) * M)},
          leaving an underlying cash {balance < 0 ? "deficit" : "surplus"} of {Math.abs(at(b.balanceShare, year)).toFixed(1)}% of GDP.
          This is the final outcome for the year.
        </p>
      </section>

      <section className="figures four" aria-label="Totals">
        <div>
          <strong>{estimates[0] ? signedMoney(estimates[0].value * M) : "n/a"}</strong>
          <span>{estimates[0] ? `is the Budget’s estimated balance for ${estimates[0].year}` : "no estimate published"}</span>
        </div>
        <div>
          <strong>{money(at(b.netDebt, year) * M)}</strong>
          <span>net debt at the end of {year}, which is {at(b.netDebtShare, year).toFixed(1)}% of GDP</span>
        </div>
        <div>
          <strong>{money(at(b.netInterest, year) * M)}</strong>
          <span>paid in net interest on that debt during {year}</span>
        </div>
        <div>
          <strong>{agsLatest ? money(agsLatest.value) : "n/a"}</strong>
          <span>
            {agsLatest
              ? `in government securities on issue at ${period(agsLatest.period)}: the gross debt, before financial assets are netted off, updated monthly by the AOFM`
              : `gross debt not available. ${ags.error}`}
          </span>
        </div>
      </section>

      <section>
        <h2>Where the money is planned to go in {b.budgetYear}</h2>
        <p className="note">
          Budget estimates of expenses by function, {money(total * M)} in all. “Other purposes” is mostly GST and
          other payments passed to the states, plus interest on debt.
        </p>
        <ol className="rank">
          {b.functions.map((f) => (
            <li key={f.name}>
              <span className="name">{f.name}</span>
              <span className="bar" style={{ ["--w" as any]: `${pct(at(f.series, b.budgetYear), at(b.functions[0].series, b.budgetYear))}%` }} />
              <span className="val">
                {money(at(f.series, b.budgetYear) * M)} <small>({((at(f.series, b.budgetYear) / total) * 100).toFixed(1)}%)</small>
              </span>
            </li>
          ))}
        </ol>
        {src("Budget Paper No. 1 tables")}
      </section>

      <section>
        <h2>Over time</h2>
        <div className="cards">
          <article className="card">
            <h3>Budget balance, share of GDP</h3>
            <LineChart series={series("balance", "Underlying cash balance as a share of GDP", "%", b.balanceShare, 1)} />
            <p className="note">Underlying cash balance. Above zero is a surplus, below is a deficit. Final outcomes only.</p>
          </article>
          <article className="card">
            <h3>Net debt, share of GDP</h3>
            <LineChart series={series("debt", "Net debt as a share of GDP", "%", b.netDebtShare, 1)} />
            <p className="note">What the Commonwealth owes, less the financial assets it could sell to repay it.</p>
          </article>
          {ags.data && (
            <article className="card" id="ags-on-issue">
              <h3>Government securities on issue</h3>
              <LineChart series={ags.data} />
              <p className="note">{ags.data.note}</p>
              <p className="src"><a href={ags.data.sourceUrl} target="_blank" rel="noreferrer">{ags.data.source}</a></p>
            </article>
          )}
        </div>
      </section>

      <section>
        <h2>Outcomes and estimates</h2>
        <p className="note">Final outcomes for past years, then the Budget’s estimates.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">Receipts</th>
                <th scope="col" className="num">Payments</th>
                <th scope="col" className="num">Balance</th>
                <th scope="col" className="num">Balance, % of GDP</th>
                <th scope="col" className="num">Net debt</th>
              </tr>
            </thead>
            <tbody>
              {b.receipts.slice(-10).map((r) => (
                <tr key={r.year}>
                  <td>{r.year}{r.estimate && " (est)"}</td>
                  <td className="num">{money(r.value * M)}</td>
                  <td className="num">{money(at(b.payments, r.year) * M)}</td>
                  <td className="num">{signedMoney(at(b.balance, r.year) * M)}</td>
                  <td className="num">{at(b.balanceShare, r.year).toFixed(1).replace("-", "−")}%</td>
                  <td className="num">{money(at(b.netDebt, r.year) * M)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {b.programs.length > 0 && (
        <section>
          <h2>The 20 largest programs in {b.budgetYear}</h2>
          <p className="note">
            Program expenses from every agency’s Portfolio Budget Statement. Programs can’t be added up to the
            total above, because money passed between agencies is counted by both.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Program</th>
                  <th scope="col">Agency</th>
                  <th scope="col">Portfolio</th>
                  <th scope="col" className="num">Expenses</th>
                </tr>
              </thead>
              <tbody>
                {b.programs.map((p) => (
                  <tr key={p.agency + p.program}>
                    <td>{p.program}</td>
                    <td>{p.agency}</td>
                    <td>{p.portfolio}</td>
                    <td className="num">{money(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {src("PBS program expenses line items")}
        </section>
      )}

      <section>
        <h2>Assets sold since 1987</h2>
        {sales.data ? (
          <>
            <div className="figures">
              <div>
                <strong>{money(sales.data.total)}</strong>
                <span>raised from selling {num(sales.data.sales.length)} Commonwealth businesses and holdings, in the dollars of the day</span>
              </div>
              <div>
                <strong>{sales.data.largest[0] ? money(sales.data.largest[0].proceeds!) : "n/a"}</strong>
                <span>{sales.data.largest[0] ? `the largest: ${sales.data.largest[0].name}, ${sales.data.largest[0].when}` : ""}</span>
              </div>
              <div>
                <strong>{sales.data.byDecade.sort((x, y) => y.value - x.value)[0]?.decade ?? "n/a"}</strong>
                <span>the decade that sold the most, {money(sales.data.byDecade[0]?.value ?? 0)} across {num(sales.data.byDecade[0]?.count ?? 0)} sales</span>
              </div>
            </div>
            <p className="note">
              Trade sales and public share offers managed by the Commonwealth, as the Department of Finance lists them.
              Property sales and sales run by agencies themselves are not on the list. Proceeds are as published at the
              time and not adjusted for inflation.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What was sold</th>
                    <th scope="col">How</th>
                    <th scope="col" className="num">Proceeds</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sales.data.sales].reverse().map((s) => (
                    <tr key={s.when + s.name}>
                      <td>{s.when}</td>
                      <td>
                        <a href={sales.data!.sourceUrl} target="_blank" rel="noreferrer">{s.name}</a>
                        {s.note && <div className="desc">{s.note}</div>}
                      </td>
                      <td>{s.kind}</td>
                      <td className="num">{s.proceeds !== null ? money(s.proceeds) : "not stated"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="src"><a href={sales.data.sourceUrl} target="_blank" rel="noreferrer">Department of Finance, past sales</a></p>
          </>
        ) : (
          <p className="note">The Department of Finance’s past sales page didn’t load. {sales.error}</p>
        )}
      </section>

      <footer>
        Source: {b.edition}, published by the Department of Finance on data.gov.au under CC BY 4.0. Past
        years are final outcomes, as later confirmed in each year’s Final Budget Outcome. Years marked (est)
        are estimates from the {b.budgetYear} Budget. General government sector, cash basis unless stated.
      </footer>
    </>
  );
}
