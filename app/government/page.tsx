import type { Metadata } from "next";
import { tryGetAps, band } from "@/lib/sources/apsc";
import { num, pct, period } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Government" };

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}`;
const share = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");

export default async function Page() {
  const { data: d, error } = await tryGetAps();
  if (!d) {
    return (
      <section className="error">
        <h1>The APS Employment Database didn’t load.</h1>
        <p>{error}</p>
      </section>
    );
  }

  const { latest, previous, yearAgo } = d;
  const sinceLast = previous ? latest.total - previous.total : null;
  const sinceYear = yearAgo ? latest.total - yearAgo.total : null;
  const ses = d.bands.find((b) => b.level === "SES");
  const top = d.agencies.slice(0, 15);
  const src = <p className="src"><a href={latest.datasetUrl} target="_blank" rel="noreferrer">Australian Public Service Commission, {latest.title}</a></p>;

  return (
    <>
      <section className="hero">
        <h1>
          <span className="big">{num(latest.total)}</span> people worked in the Australian Public Service at {latest.label}.
        </h1>
        <p>
          Headcount of everyone employed under the Public Service Act, ongoing and non-ongoing, full and part time.
          {sinceYear !== null && yearAgo && <> That is {signed(sinceYear)} on {yearAgo.label} ({share(sinceYear, yearAgo.total)}).</>}
          {" "}Excludes the military, the ABC, the NBN and other bodies outside the Act.
        </p>
      </section>

      <section className="figures" aria-label="Totals">
        <div>
          <strong>{sinceLast !== null ? signed(sinceLast) : "n/a"}</strong>
          <span>{previous ? `change since the previous snapshot at ${previous.label} (${share(sinceLast ?? 0, previous.total)})` : "no earlier snapshot loaded"}</span>
        </div>
        <div>
          <strong>{share(latest.women, latest.total)}</strong>
          <span>are women: {num(latest.women)} women, {num(latest.men)} men{latest.other > 0 && `, ${num(latest.other)} recorded as X`}</span>
        </div>
        <div>
          <strong>{ses ? num(ses.total) : "n/a"}</strong>
          <span>are in the Senior Executive Service, {ses ? share(ses.total, latest.total) : ""} of the service; {ses ? share(ses.women, ses.total) : ""} of them women</span>
        </div>
      </section>

      <section>
        <h2>Who works in it, by level</h2>
        <p className="note">
          APS 1 to 6 are the general grades, EL 1 and 2 are executive levels, SES is the senior executive. Gender X is not
          reported by level because the numbers are small; it is included in the totals above.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col" className="num">Men</th>
                <th scope="col" className="num">Women</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Women</th>
                <th scope="col" className="num">Share of APS</th>
              </tr>
            </thead>
            <tbody>
              {d.levels.map((l) => (
                <tr key={l.level}>
                  <td>{l.level}<div className="desc">{band(l.level)}</div></td>
                  <td className="num">{num(l.men)}</td>
                  <td className="num">{num(l.women)}</td>
                  <td className="num">{num(l.total)}</td>
                  <td className="num">{share(l.women, l.total)}</td>
                  <td className="num">{share(l.total, latest.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {src}
      </section>

      <section>
        <h2>The 15 largest agencies</h2>
        <p className="note">
          Headcount at {latest.label}. Departments and their portfolio agencies are listed separately, as the APSC
          publishes them. The change is against {previous ? previous.label : "the previous snapshot"}.
        </p>
        <ol className="rank">
          {top.map((a) => (
            <li key={a.agency}>
              <span className="name">
                {a.agency}
                {a.parent && <small>{a.parent} portfolio</small>}
                <small>{share(a.women, a.men + a.women)} women</small>
              </span>
              <span className="bar" style={{ ["--w" as any]: `${pct(a.total, top[0].total)}%` }} />
              <span className="val">
                {num(a.total)} {a.previous !== null && <small>({signed(a.total - a.previous)})</small>}
              </span>
            </li>
          ))}
        </ol>
        <details>
          <summary>Every agency ({num(d.agencies.length)})</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Agency</th>
                  <th scope="col" className="num">Men</th>
                  <th scope="col" className="num">Women</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {d.agencies.map((a) => (
                  <tr key={a.agency}>
                    <td>{a.parent ? <>{a.agency}<div className="desc">{a.parent} portfolio</div></> : a.agency}</td>
                    <td className="num">{num(a.men)}</td>
                    <td className="num">{num(a.women)}</td>
                    <td className="num">{num(a.total)}</td>
                    <td className="num">{a.previous !== null ? signed(a.total - a.previous) : "new"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {src}
      </section>

      <section>
        <h2>Over time</h2>
        <div className="cards">
          {[d.history.total, d.history.women, d.history.men].map((s) => (
            <article key={s.id} id={s.id} className="card">
              <h3>{s.label}</h3>
              <p className="stat">
                <strong>{num(s.points[s.points.length - 1].value)}</strong>
                <span>{period(s.points[s.points.length - 1].period)}</span>
              </p>
              <LineChart series={s} />
              <p className="note">{s.note}</p>
              <p className="src"><a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.source}</a></p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Snapshots loaded</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Snapshot</th>
                <th scope="col" className="num">Headcount</th>
                <th scope="col" className="num">Women</th>
                <th scope="col" className="num">Men</th>
                <th scope="col">Dataset</th>
              </tr>
            </thead>
            <tbody>
              {d.releases.map((r) => (
                <tr key={r.date}>
                  <td>{r.label}</td>
                  <td className="num">{num(r.total)}</td>
                  <td className="num">{num(r.women)}</td>
                  <td className="num">{num(r.men)}</td>
                  <td><a href={r.datasetUrl} target="_blank" rel="noreferrer">data.gov.au</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.skipped.length > 0 && <p className="note">Found but not readable: {d.skipped.join("; ")}.</p>}
      </section>

      <footer>
        Source: APS Employment Database releases published by the Australian Public Service Commission on data.gov.au under
        CC BY 3.0 AU. Figures are headcount at the snapshot date, not full-time equivalent. Every cell of the agency table is
        stored as published, including the nil cells.
      </footer>
    </>
  );
}
