import type { Metadata } from "next";
import { tryGetRevenue, RECEIPTS_URL, SHARE_URL, type YearValue } from "@/lib/sources/treasury";
import { tryGetTaxByLevel } from "@/lib/sources/abs-tax";
import type { Series } from "@/lib/sources/types";
import { money, pct } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Revenue" };

const M = 1_000_000; // both sources report in $ million
const at = (s: YearValue[], year: string) => s.find((p) => p.year === year)?.value ?? 0;
const growth = (now: number, before: number) => (before ? ((now - before) / before) * 100 : 0);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

// Charts show final figures only; estimates stay in the table where they are labelled.
function toSeries(id: string, label: string, unit: Series["unit"], values: YearValue[], scale: number, note: string, sourceUrl: string): Series {
  return {
    id, label, unit, frequency: "yearly", decimals: 1, note, sourceUrl,
    source: "Treasury, Budget Paper No. 1, Statement 5",
    points: values.filter((v) => !v.estimate).map((v) => ({ period: `FY${v.year}`, value: v.value * scale })),
  };
}

export default async function Page() {
  const [revenue, levels] = await Promise.all([tryGetRevenue(), tryGetTaxByLevel()]);
  const r = revenue.data;

  if (!r) {
    return (
      <section className="error">
        <h1>Treasury’s revenue tables didn’t load.</h1>
        <p>{revenue.error}</p>
      </section>
    );
  }

  const year = r.latestActual;
  const actual = r.total.filter((t) => !t.estimate);
  const prev = actual[actual.length - 2];
  const total = at(r.total, year);
  const nextEstimate = r.total.find((t) => t.estimate);
  const tableYears = [...actual.slice(-3), ...r.total.filter((t) => t.estimate).slice(0, 2)];
  const l = levels.data;

  return (
    <>
      <section className="hero">
        <h1>
          <span className="big">{money(total * M)}</span> reached the Commonwealth in {year}, from every source.
        </h1>
        <p>
          That is {at(r.shareOfGdp, year).toFixed(1)}% of the whole economy
          {prev && <>, and {signed(growth(total, prev.value))} on {prev.year}</>}. Cash receipts, as reported in
          the Budget.
        </p>
      </section>

      <section className="figures" aria-label="Totals">
        <div>
          <strong>{pct(at(r.tax, year), total)}%</strong>
          <span>came from taxes. The rest is interest, dividends and other non-tax receipts</span>
        </div>
        <div>
          <strong>{pct(at(r.lines[0].series, year), total)}%</strong>
          <span>came from the largest single source: {r.lines[0].name.toLowerCase()}</span>
        </div>
        <div>
          <strong>{nextEstimate ? money(nextEstimate.value * M) : "n/a"}</strong>
          <span>{nextEstimate ? `is the Budget estimate for ${nextEstimate.year}` : "no estimate published"}</span>
        </div>
      </section>

      <section>
        <h2>Where it came from in {year}</h2>
        <p className="note">Every head of revenue in the Budget. Together they add up to total receipts.</p>
        <ol className="rank">
          {r.lines.filter((line) => at(line.series, year) !== 0).map((line) => (
            <li key={line.name}>
              <span className="name">
                {line.name} <small>{line.group}</small>
                {line.parts && (
                  <span className="parts">
                    {line.parts.map((p) => `${p.name} ${money(at(p.series, year) * M)}`).join(" · ")}
                  </span>
                )}
              </span>
              <span className="bar" style={{ ["--w" as any]: `${Math.max(0, pct(at(line.series, year), at(r.lines[0].series, year)))}%` }} />
              <span className="val">
                {money(at(line.series, year) * M)} <small>({((at(line.series, year) / total) * 100).toFixed(1)}%)</small>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Over time</h2>
        <div className="cards">
          <article className="card">
            <h3>Total receipts</h3>
            <LineChart series={toSeries("receipts", "Total Commonwealth receipts", "AUD", r.total, M, "", RECEIPTS_URL)} />
            <p className="note">Cash receipts in dollars of the day, not adjusted for inflation.</p>
            <p className="src"><a href={RECEIPTS_URL} target="_blank" rel="noreferrer">Treasury, Budget Paper No. 1, Statement 5, table 1</a></p>
          </article>
          <article className="card">
            <h3>Receipts as a share of the economy</h3>
            <LineChart series={toSeries("receipts-gdp", "Commonwealth receipts as a share of GDP", "%", r.shareOfGdp, 1, "", SHARE_URL)} />
            <p className="note">Total cash receipts as a percentage of GDP. This is the fairer comparison across decades.</p>
            <p className="src"><a href={SHARE_URL} target="_blank" rel="noreferrer">Treasury, Budget Paper No. 1, Statement 5, table 2</a></p>
          </article>
        </div>
      </section>

      <section>
        <h2>Year by year</h2>
        <p className="note">Final figures, then the Budget’s own estimates. Change is {year} on the year before.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Source</th>
                {tableYears.map((y) => (
                  <th key={y.year} scope="col" className="num">{y.year}{y.estimate && " (est)"}</th>
                ))}
                <th scope="col" className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {[...r.lines.filter((line) => tableYears.some((y) => at(line.series, y.year) !== 0)), { name: "Total receipts", series: r.total }].map((line) => (
                <tr key={line.name} className={line.name === "Total receipts" ? "total" : undefined}>
                  <td>{line.name}</td>
                  {tableYears.map((y) => <td key={y.year} className="num">{money(at(line.series, y.year) * M)}</td>)}
                  <td className="num">{prev && at(line.series, prev.year) ? signed(growth(at(line.series, year), at(line.series, prev.year))) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>All levels of government</h2>
        {l ? (
          <>
            <p className="note">
              Taxes only, {l.latest}. The ABS counts GST as a Commonwealth tax even though it is passed on to the states.
            </p>
            <div className="split">
              <ol className="rank">
                {[
                  { name: "Commonwealth", value: at(l.commonwealth, l.latest) },
                  { name: "State and local", value: at(l.stateAndLocal, l.latest) },
                ].map((row) => (
                  <li key={row.name}>
                    <span className="name">{row.name}</span>
                    <span className="bar" style={{ ["--w" as any]: `${pct(row.value, at(l.commonwealth, l.latest))}%` }} />
                    <span className="val">
                      {money(row.value * M)}{" "}
                      <small>({pct(row.value, at(l.commonwealth, l.latest) + at(l.stateAndLocal, l.latest))}% of all tax)</small>
                    </span>
                  </li>
                ))}
              </ol>
              <ol className="rank">
                {l.stateLines.map((line) => (
                  <li key={line.name}>
                    <span className="name">{line.name} <small>state and local</small></span>
                    <span className="bar" style={{ ["--w" as any]: `${pct(at(line.series, l.latest), at(l.stateLines[0].series, l.latest))}%` }} />
                    <span className="val">{money(at(line.series, l.latest) * M)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="src"><a href={l.releaseUrl} target="_blank" rel="noreferrer">ABS, Taxation Revenue, Australia, {l.latest}</a></p>
          </>
        ) : (
          <p className="note">The ABS taxation release didn’t load. {levels.error}</p>
        )}
      </section>

      <footer>
        Commonwealth figures are cash receipts of the general government sector from Budget Paper No. 1,
        Statement 5, published by Treasury. Years marked (est) are Budget estimates, not outcomes. State
        and local figures are from the ABS and cover taxes only, so the two sections are not directly
        comparable line by line.
      </footer>
    </>
  );
}
