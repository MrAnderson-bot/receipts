import type { Metadata } from "next";
import { tryGetMigration, type CategoryCount, type Part } from "@/lib/sources/migration";
import type { Series } from "@/lib/sources/types";
import { value, delta, onPrevious, period, num, pct } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 21_600;
export const metadata: Metadata = { title: "Migration" };

const people = (n: number | null) => (n === null ? "<5 or n/a" : num(n));
const fyLabel = (y: string) => y.replace(/^FY/, "");

// Signed change between two counts, as the publisher would quote it.
function moved(now: number | null, before: number | null) {
  if (now === null || before === null) return null;
  const d = now - before;
  const share = before ? Math.round((d / before) * 1000) / 10 : null;
  return `${d >= 0 ? "+" : "−"}${num(Math.abs(d))}${share !== null ? ` (${d >= 0 ? "+" : "−"}${Math.abs(share)}%)` : ""}`;
}

function Failed({ what, error }: { what: string; error: string | null }) {
  return <p className="note">{what} didn’t load. {error}</p>;
}

function Card({ series }: { series: Series }) {
  const last = series.points[series.points.length - 1];
  const prev = series.points[series.points.length - 2];
  const d = prev ? last.value - prev.value : null;
  return (
    <article className="card" id={series.id}>
      <h3>{series.label}</h3>
      <p className="stat">
        <strong>{value(last.value, series.unit, series.decimals)}</strong>
        <span>
          {period(last.period)}
          {d !== null && <> · {onPrevious(delta(d, series.unit, series.decimals))}</>}
        </span>
      </p>
      <LineChart series={series} />
      <p className="note">{series.note}</p>
      <p className="src"><a href={series.sourceUrl} target="_blank" rel="noreferrer">{series.source}</a></p>
    </article>
  );
}

function Breakdown({ items, nowLabel, beforeLabel }: { items: CategoryCount[]; nowLabel: string; beforeLabel: string | null }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" className="num">{nowLabel}</th>
            {beforeLabel && <th scope="col" className="num">{beforeLabel}</th>}
            {beforeLabel && <th scope="col" className="num">Change</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td className="num">{people(c.count)}</td>
              {beforeLabel && <td className="num">{people(c.previous)}</td>}
              {beforeLabel && <td className="num">{moved(c.count, c.previous) ?? ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const releaseNote = (p: Part<{ release: { name: string; url: string; modified: string } }>) =>
  p.data && (
    <p className="src">
      File: <a href={p.data.release.url}>{p.data.release.name}</a>, updated {p.data.release.modified}.
    </p>
  );

export default async function Page() {
  const m = await tryGetMigration();
  const nom = m.nom.data, temp = m.tempHolders.data, perm = m.permanent.data, skilled = m.skilled.data, whm = m.whm.data, pkg = m.package.data;

  return (
    <>
      {nom ? (
        <section className="hero">
          <h1>
            <span className="big">{value(nom.latest.nom, "people", 0)}</span> net overseas migration in {fyLabel(nom.latest.year)}.
          </h1>
          <p>
            {num(nom.latest.arrivals)} long-term arrivals minus {num(nom.latest.departures)} long-term departures, year to 30 June.
            {nom.latest.previousNom !== null && <> {moved(nom.latest.nom, nom.latest.previousNom)} on the year before.</>} The
            latest year is preliminary and the ABS revises it.
          </p>
        </section>
      ) : (
        <section className="error">
          <h1>Net overseas migration didn’t load.</h1>
          <p>{m.nom.error}</p>
        </section>
      )}

      <section className="figures four" aria-label="Headline figures">
        <div>
          <strong>{temp ? value(temp.latest.total, "people", 2) : "–"}</strong>
          <span>{temp ? `temporary visa holders in Australia at ${period(temp.latest.date)}` : `temporary visa holders: ${m.tempHolders.error}`}</span>
        </div>
        <div>
          <strong>{perm ? num(perm.latest.total) : "–"}</strong>
          <span>{perm ? `permanent Migration Program places in ${perm.latest.year}` : `permanent program: ${m.permanent.error}`}</span>
        </div>
        <div>
          <strong>{skilled ? num(skilled.latest.total) : "–"}</strong>
          <span>{skilled ? `temporary skilled visas granted in ${skilled.latest.year.year}` : `skilled visas: ${m.skilled.error}`}</span>
        </div>
        <div>
          <strong>{whm ? num(whm.latest.total) : "–"}</strong>
          <span>{whm ? `working holiday visas granted in ${whm.latest.year.year}` : `working holiday: ${m.whm.error}`}</span>
        </div>
      </section>

      <section>
        <h2>Over time</h2>
        <p className="note">
          Each series measures something different: people present on a date, visas granted in a year, program places
          delivered, or net long-term movement. They are shown side by side, not added together.
        </p>
        <div className="cards">
          {nom && <Card series={nom.series} />}
          {temp && <Card series={temp.series} />}
          {pkg && <Card series={pkg.program.series} />}
          {pkg && <Card series={pkg.tempGranted.series} />}
          {skilled && <Card series={skilled.series} />}
          {whm && <Card series={whm.series} />}
        </div>
      </section>

      <div className="split">
        <section>
          <h2>Who is here on a temporary visa</h2>
          {temp ? (
            <>
              <p className="note">
                Holders by visa category at {period(temp.latest.date)}
                {temp.latest.previousDate && <> against {period(temp.latest.previousDate)}</>}. Bridging Visa E holders are excluded by the publisher.
              </p>
              <Breakdown items={temp.latest.byCategory} nowLabel={period(temp.latest.date)} beforeLabel={temp.latest.previousDate ? period(temp.latest.previousDate) : null} />
              {releaseNote(m.tempHolders)}
            </>
          ) : <Failed what="Temporary visa holders" error={m.tempHolders.error} />}
        </section>

        <section>
          <h2>Net overseas migration by visa</h2>
          {pkg ? (
            <>
              <p className="note">
                Calendar year {pkg.nomByCategory.year}, from the Home Affairs statistics package. Arrivals and departures are
                long-term movements as counted by the ABS; net is the difference.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Visa category</th>
                      <th scope="col" className="num">Arrivals</th>
                      <th scope="col" className="num">Departures</th>
                      <th scope="col" className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pkg.nomByCategory.categories].sort((a, b) => b.net - a.net).map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{num(c.arrivals)}</td>
                        <td className="num">{num(c.departures)}</td>
                        <td className="num">{c.net < 0 ? "−" : ""}{num(Math.abs(c.net))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                {pkg.nomByCategory.temporaryTotal && <>Temporary visas net {num(pkg.nomByCategory.temporaryTotal.net)}. </>}
                {pkg.nomByCategory.permanentTotal && <>Permanent visas net {num(pkg.nomByCategory.permanentTotal.net)}.</>}
              </p>
            </>
          ) : <Failed what="Migration statistics package" error={m.package.error} />}
        </section>
      </div>

      <div className="split">
        <section>
          <h2>Permanent Migration Program</h2>
          {perm ? (
            <>
              <p className="note">Places delivered in {perm.latest.year} by visa category, against {perm.years[perm.years.length - 2] ?? "the year before"}.</p>
              <Breakdown items={perm.latest.byCategory} nowLabel={perm.latest.year} beforeLabel={perm.years[perm.years.length - 2] ?? null} />
              {releaseNote(m.permanent)}
            </>
          ) : <Failed what="Permanent program outcomes" error={m.permanent.error} />}
        </section>

        <section>
          <h2>Where skilled visa holders are nominated to work</h2>
          {skilled ? (
            <>
              <p className="note">
                Temporary skilled visas granted in {skilled.latest.year.year} by nominated position location, primary applicants
                (the worker) and secondary applicants (their family).
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">State or territory</th>
                      {skilled.latest.byGroup.map((g) => <th key={g.name} scope="col" className="num">{g.name}</th>)}
                      <th scope="col" className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(skilled.latest.byItem.map((r) => r.item))]
                      .map((item) => ({ item, cols: skilled.latest.byGroup.map((g) => skilled.latest.byItem.find((r) => r.item === item && r.group === g.name)?.count ?? null) }))
                      .sort((a, b) => b.cols.reduce<number>((s, v) => s + (v ?? 0), 0) - a.cols.reduce<number>((s, v) => s + (v ?? 0), 0))
                      .map((r) => (
                        <tr key={r.item}>
                          <td>{r.item}</td>
                          {r.cols.map((v, i) => <td key={i} className="num">{people(v)}</td>)}
                          <td className="num">{num(r.cols.reduce<number>((s, v) => s + (v ?? 0), 0))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {skilled.years.some((y) => y.partial) && (
                <p className="note">
                  The file also carries {skilled.years.filter((y) => y.partial).map((y) => y.label).join(", ")}: {num(skilled.totals[skilled.years.findIndex((y) => y.partial)] ?? 0)} grants so far, not a full year.
                </p>
              )}
              {releaseNote(m.skilled)}
            </>
          ) : <Failed what="Skilled visa grants" error={m.skilled.error} />}
        </section>
      </div>

      <div className="split">
        <section>
          <h2>Working holiday makers</h2>
          {whm ? (
            <>
              <p className="note">Visas granted in {whm.latest.year.year} by subclass and whether it was a first, second or third visa.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">Subclass</th><th scope="col">Visa</th><th scope="col" className="num">Granted</th></tr>
                  </thead>
                  <tbody>
                    {whm.latest.byItem.filter((r) => r.count !== null && r.count > 0).map((r) => (
                      <tr key={`${r.group}|${r.item}`}>
                        <td>{r.group}</td>
                        <td>{r.item}</td>
                        <td className="num">{people(r.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                {whm.latest.byGroup.map((g) => `${g.name}: ${num(g.count ?? 0)}`).join(". ")}. Third visas exist since 1 July 2019.
                “Nil VAC” visas were fee-free grants during the pandemic.
              </p>
              {releaseNote(m.whm)}
            </>
          ) : <Failed what="Working holiday grants" error={m.whm.error} />}
        </section>

        <section>
          <h2>New citizens by former citizenship</h2>
          {pkg ? (
            <>
              <p className="note">
                {pkg.citizenship.total !== null && <>{num(pkg.citizenship.total)} people became citizens in {pkg.citizenship.year}. </>}
                Top {pkg.citizenship.countries.length} countries of original citizenship
                {pkg.citizenship.other !== null && <>; all other countries together {num(pkg.citizenship.other)}</>}. The package
                does not carry earlier years.
              </p>
              <ol className="rank">
                {pkg.citizenship.countries.map((c) => (
                  <li key={c.name}>
                    <span className="name">{c.name}</span>
                    <span className="bar" style={{ ["--w" as any]: `${pct(c.count, pkg.citizenship.countries[0].count)}%` }} />
                    <span className="val">{num(c.count)}</span>
                  </li>
                ))}
              </ol>
              {releaseNote(m.package)}
            </>
          ) : <Failed what="Citizenship table" error={m.package.error} />}
        </section>
      </div>

      {pkg && (
        <section>
          <h2>Temporary visas granted, {pkg.tempGranted.years[pkg.tempGranted.years.length - 1]}</h2>
          <p className="note">
            Every temporary visa category, from the statistics package. Visitor visas dominate the count, and a grant is not an arrival.
          </p>
          <ol className="rank">
            {pkg.tempGranted.categories
              .map((c) => ({ name: c.name, count: c.counts[c.counts.length - 1] }))
              .sort((a, b) => b.count - a.count)
              .map((c, _, all) => (
                <li key={c.name}>
                  <span className="name">{c.name}</span>
                  <span className="bar" style={{ ["--w" as any]: `${pct(c.count, all[0].count)}%` }} />
                  <span className="val">{num(c.count)}</span>
                </li>
              ))}
          </ol>
        </section>
      )}

      <footer>
        Sources: Department of Home Affairs pivot-table exports and the Australian Migration Statistics package on data.gov.au,
        licensed CC BY 3.0 AU; ABS Overseas Migration through the ABS Data API, CC BY 4.0. The Home Affairs exports show only the
        dimensions in each sheet: country, age, gender and occupation are collapsed to “(All)” and are not available. Counts of
        1 to 4 are published as “&lt;5” and appear here as “&lt;5 or n/a”, so category totals can undercount slightly. Programme
        years run July to June. Figures are as published and change when the publisher revises them.
      </footer>
    </>
  );
}
