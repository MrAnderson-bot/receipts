import type { Metadata } from "next";
import { tryGetCrime, VICTIM_OFFENCES, STATE_CODES, REGION_NAMES, type Victims, type Offenders } from "@/lib/sources/crime";
import { tryGetHomelessness, type Shs, type Census } from "@/lib/sources/homelessness";
import type { Series } from "@/lib/sources/types";
import { value, delta, onPrevious, period, num } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 21_600;
export const metadata: Metadata = { title: "Crime and homelessness" };

const fyLabel = (y: string) => y.replace(/^FY/, "");
const show = (n: number | null, decimals = 0) => (n === null ? "np" : n.toLocaleString("en-AU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
const last = <T,>(xs: T[]) => xs[xs.length - 1];

function moved(now: number | null, before: number | null, decimals = 0) {
  if (now === null || before === null) return "";
  const d = now - before;
  const share = before ? Math.round((d / before) * 1000) / 10 : null;
  return `${d >= 0 ? "+" : "−"}${show(Math.abs(d), decimals)}${share !== null ? ` (${d >= 0 ? "+" : "−"}${Math.abs(share)}%)` : ""}`;
}

function Card({ series }: { series: Series }) {
  const a = last(series.points), b = series.points[series.points.length - 2];
  const d = b ? a.value - b.value : null;
  return (
    <article className="card" id={series.id}>
      <h3>{series.label}</h3>
      <p className="stat">
        <strong>{value(a.value, series.unit, series.decimals)}</strong>
        <span>
          {period(a.period)}
          {d !== null && <> · {onPrevious(delta(d, series.unit, series.decimals))}</>}
        </span>
      </p>
      <LineChart series={series} />
      <p className="note">{series.note}</p>
      <p className="src"><a href={series.sourceUrl} target="_blank" rel="noreferrer">{series.source}</a></p>
    </article>
  );
}

function Failed({ what, error }: { what: string; error: string | null }) {
  return <p className="note">{what} didn’t load. {error}</p>;
}

// --- victims ------------------------------------------------------------------

function VictimsSection({ v }: { v: Victims }) {
  const byId = new Map(v.series.map((s) => [s.id, s]));
  const latest = v.years.length - 1;
  const aus = (slug: string) => v.rows.find((r) => r.region === "AUS" && r.slug === slug);
  // Chart the rate where the ABS publishes one for Australia, otherwise the count.
  const cards = VICTIM_OFFENCES.flatMap((o) => {
    const s = byId.get(`crime:victim-rate:AUS:${o.slug}`) ?? byId.get(`crime:victims:AUS:${o.slug}`);
    return s ? [s] : [];
  });
  const offencesWithStates = VICTIM_OFFENCES.filter((o) => v.rows.some((r) => r.region !== "AUS" && r.slug === o.slug));
  const cell = (region: string, slug: string) => {
    const r = v.rows.find((x) => x.region === region && x.slug === slug);
    if (!r) return "–";
    const rate = r.rates[latest];
    return rate !== null ? show(rate, 1) : r.counts[latest] !== null ? `${show(r.counts[latest])} victims` : "np";
  };
  return (
    <>
      <section>
        <h2>Victims of crime, Australia</h2>
        <p className="note">
          Offences recorded by state and territory police, as compiled by the ABS for calendar year {v.edition}. Rates are
          victims per 100,000 people. For the property offences the ABS publishes national counts only, so those charts
          show counts. Assault is published by state but not nationally, because states record it differently.
        </p>
        <div className="cards">{cards.map((s) => <Card key={s.id} series={s} />)}</div>
      </section>

      <section>
        <h2>By state and territory, {v.edition}</h2>
        <p className="note">Victims per 100,000 people. Where a state publishes no rate the count is shown instead; np means the ABS did not publish the figure.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Offence</th>
                {STATE_CODES.map((c) => <th key={c} scope="col" className="num">{c}</th>)}
                <th scope="col" className="num">Australia</th>
              </tr>
            </thead>
            <tbody>
              {offencesWithStates.map((o) => (
                <tr key={o.slug}>
                  <td>{o.name}</td>
                  {STATE_CODES.map((c) => <td key={c} className="num">{cell(c, o.slug)}</td>)}
                  <td className="num">{aus(o.slug) ? cell("AUS", o.slug) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="src">
          Files: <a href={v.files.national} target="_blank" rel="noreferrer">Victims of crime, Australia (Tables 1 to 8)</a> and{" "}
          <a href={v.files.states} target="_blank" rel="noreferrer">states and territories (Tables 9 to 16)</a>, from the{" "}
          <a href={v.page} target="_blank" rel="noreferrer">ABS release</a>.
        </p>
      </section>
    </>
  );
}

// --- offenders ------------------------------------------------------------------

function OffendersSection({ o }: { o: Offenders }) {
  const byId = new Map(o.series.map((s) => [s.id, s]));
  const latest = o.years.length - 1;
  const total = o.national.find((r) => r.code === "TOT");
  const totalRate = byId.get("crime:offender-rate:AUS:total");
  const divisions = o.national.filter((r) => r.code !== "TOT").sort((a, b) => (b.counts[latest] ?? 0) - (a.counts[latest] ?? 0));
  const stateLatest = o.stateYears.length - 1;
  const stateCell = (region: string, code: string) => show(o.states.find((r) => r.region === region && r.code === code)?.rates[stateLatest] ?? null, 1);
  return (
    <section>
      <h2>Offenders, {o.edition}</h2>
      <p className="note">
        People aged 10 and over proceeded against by police, counted once in the financial year by their most serious
        offence. Rates are offenders per 100,000 people aged 10 and over.
      </p>
      <div className="figures">
        <div>
          <strong>{total ? show(total.counts[latest]) : "–"}</strong>
          <span>offenders proceeded against by police in {fyLabel(last(o.years))}</span>
        </div>
        <div>
          <strong>{total ? show(total.rates[latest], 1) : "–"}</strong>
          <span>per 100,000 people aged 10 and over{total ? `, ${moved(total.rates[latest], total.rates[latest - 1] ?? null, 1)} on the year before` : ""}</span>
        </div>
        <div>
          <strong>{divisions[0] ? show(divisions[0].counts[latest]) : "–"}</strong>
          <span>{divisions[0] ? `the largest group: ${divisions[0].name.toLowerCase()}` : ""}</span>
        </div>
      </div>
      {totalRate && <div className="cards"><Card series={totalRate} /></div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Principal offence</th>
              <th scope="col" className="num">Offenders {fyLabel(o.years[latest])}</th>
              <th scope="col" className="num">{o.years[latest - 1] ? fyLabel(o.years[latest - 1]) : ""}</th>
              <th scope="col" className="num">Change</th>
              <th scope="col" className="num">Per 100,000</th>
              {STATE_CODES.map((c) => <th key={c} scope="col" className="num">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {divisions.map((d) => (
              <tr key={d.code}>
                <td>{d.name}<div className="desc">ANZSOC division {d.code}</div></td>
                <td className="num">{show(d.counts[latest])}</td>
                <td className="num">{show(d.counts[latest - 1] ?? null)}</td>
                <td className="num">{moved(d.counts[latest], d.counts[latest - 1] ?? null)}</td>
                <td className="num">{show(d.rates[latest], 1)}</td>
                {STATE_CODES.map((c) => <td key={c} className="num">{stateCell(c, d.code)}</td>)}
              </tr>
            ))}
            {total && (
              <tr>
                <td><strong>All offenders</strong></td>
                <td className="num"><strong>{show(total.counts[latest])}</strong></td>
                <td className="num">{show(total.counts[latest - 1] ?? null)}</td>
                <td className="num">{moved(total.counts[latest], total.counts[latest - 1] ?? null)}</td>
                <td className="num">{show(total.rates[latest], 1)}</td>
                {STATE_CODES.map((c) => <td key={c} className="num">{stateCell(c, "TOT")}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note">State columns are offenders per 100,000 in {fyLabel(last(o.stateYears))}. Victoria counts offenders differently from other states; the ABS notes the comparison is indicative only.</p>
      <p className="src">
        Files: <a href={o.files.national} target="_blank" rel="noreferrer">Offenders, Australia</a> and{" "}
        <a href={o.files.states} target="_blank" rel="noreferrer">Offenders, states and territories</a>, from the{" "}
        <a href={o.page} target="_blank" rel="noreferrer">ABS release</a>.
      </p>
    </section>
  );
}

// --- homelessness ------------------------------------------------------------------

function HomelessnessSection({ shs, census, errors }: { shs: Shs | null; census: Census | null; errors: { shs: string | null; census: string | null } }) {
  const shsNational = shs?.regions.find((r) => r.region === "AUS");
  const shsLatest = shs ? shs.years.length - 1 : 0;
  const censusLatest = census ? census.years.length - 1 : 0;
  const shsRate = shs?.series.find((s) => s.id === "homelessness:shs-rate:AUS");
  const shsClients = shs?.series.find((s) => s.id === "homelessness:shs-clients:AUS");
  const censusCount = census?.series.find((s) => s.id === "homelessness:census-count:AUS");
  return (
    <section id="homelessness">
      <h2>Homelessness</h2>
      <p className="note">
        Two different measures. The Census counts everyone without a home on one night every five years, including people
        in severely crowded dwellings. The AIHW counts everyone a homelessness service helped during the year, whether or
        not they were homeless when they asked.
      </p>
      <div className="figures four">
        <div>
          <strong>{census ? show(census.total.counts[censusLatest]) : "–"}</strong>
          <span>{census ? `people homeless on Census night ${census.years[censusLatest]}, ${moved(census.total.counts[censusLatest], census.total.counts[censusLatest - 1] ?? null)} on ${census.years[censusLatest - 1]}` : `Census: ${errors.census}`}</span>
        </div>
        <div>
          <strong>{census ? show(census.total.rates[censusLatest], 1) : "–"}</strong>
          <span>{census ? `per 10,000 people, from ${show(census.total.rates[censusLatest - 1] ?? null, 1)} in ${census.years[censusLatest - 1]}` : ""}</span>
        </div>
        <div>
          <strong>{shsNational ? show(shsNational.clients[shsLatest]) : "–"}</strong>
          <span>{shs && shsNational ? `people helped by homelessness services in ${fyLabel(shs.latestYear)}, ${moved(shsNational.clients[shsLatest], shsNational.clients[shsLatest - 1] ?? null)} on the year before` : `AIHW: ${errors.shs}`}</span>
        </div>
        <div>
          <strong>{shsNational ? show(shsNational.perTenThousand[shsLatest], 1) : "–"}</strong>
          <span>{shsNational ? "per 10,000 people helped by a homelessness service" : ""}</span>
        </div>
      </div>

      {(censusCount || shsRate || shsClients) && (
        <div className="cards">
          {censusCount && <Card series={censusCount} />}
          {shsClients && <Card series={shsClients} />}
          {shsRate && <Card series={shsRate} />}
        </div>
      )}

      {census && (
        <>
          <h3>Where people were on Census night {census.years[censusLatest]}</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Living situation</th><th scope="col" className="num">People</th><th scope="col" className="num">Per 10,000</th></tr></thead>
              <tbody>
                {census.groups.map((g) => (
                  <tr key={g.name}><td>{g.name}</td><td className="num">{show(g.count)}</td><td className="num">{show(g.rate, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="src">File: <a href={census.file} target="_blank" rel="noreferrer">Estimating Homelessness: Census, 2021, Table 1</a>, from the <a href={census.page} target="_blank" rel="noreferrer">ABS release</a>.</p>
        </>
      )}

      {shs && (
        <>
          <h3>By state and territory</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">State or territory</th>
                  <th scope="col" className="num">Helped in {fyLabel(shs.latestYear)}</th>
                  <th scope="col" className="num">{shs.years[shsLatest - 1] ? fyLabel(shs.years[shsLatest - 1]) : ""}</th>
                  <th scope="col" className="num">Change</th>
                  <th scope="col" className="num">Per 10,000</th>
                  {census && <th scope="col" className="num">Homeless, Census {census.years[censusLatest]}</th>}
                  {census && <th scope="col" className="num">Per 10,000</th>}
                </tr>
              </thead>
              <tbody>
                {shs.regions.map((r) => {
                  const c = census?.states.find((s) => s.name === r.name) ?? (r.region === "AUS" && census ? { name: r.name, count: census.total.counts[censusLatest], rate: census.total.rates[censusLatest] } : null);
                  return (
                    <tr key={r.region}>
                      <td>{r.region === "AUS" ? <strong>Australia</strong> : r.name}</td>
                      <td className="num">{show(r.clients[shsLatest])}</td>
                      <td className="num">{show(r.clients[shsLatest - 1] ?? null)}</td>
                      <td className="num">{moved(r.clients[shsLatest], r.clients[shsLatest - 1] ?? null)}</td>
                      <td className="num">{show(r.perTenThousand[shsLatest], 1)}</td>
                      {census && <td className="num">{c ? show(c.count) : "–"}</td>}
                      {census && <td className="num">{c ? show(c.rate, 1) : "–"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3>Why people asked for help, {fyLabel(shs.latestYear)}</h3>
          <p className="note">Clients can give more than one reason, so the shares add to more than 100. Group totals are in bold.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Reason</th><th scope="col" className="num">Clients</th><th scope="col" className="num">Share of clients</th></tr></thead>
              <tbody>
                {shs.reasons.map((r, i) => (
                  <tr key={i}>
                    <td>{r.isGroup ? <strong>{r.reason}</strong> : r.reason}</td>
                    <td className="num">{r.isGroup ? <strong>{show(r.clients)}</strong> : show(r.clients)}</td>
                    <td className="num">{r.percent === null ? "" : `${show(r.percent, 1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="src">
            Files: <a href={shs.files.history.url} target="_blank" rel="noreferrer">{shs.files.history.title}</a> and{" "}
            <a href={shs.files.tables.url} target="_blank" rel="noreferrer">{shs.files.tables.title}</a>, published {shs.files.tables.date}, from the{" "}
            <a href={shs.page} target="_blank" rel="noreferrer">AIHW report</a>.
          </p>
        </>
      )}
    </section>
  );
}

// --- page ---------------------------------------------------------------------------

export default async function Page() {
  const [crime, homelessness] = await Promise.all([tryGetCrime(), tryGetHomelessness()]);
  const v = crime.victims.data, o = crime.offenders.data, shs = homelessness.shs.data, census = homelessness.census.data;
  const vLatest = v ? v.years.length - 1 : 0;
  const aus = (slug: string) => v?.rows.find((r) => r.region === "AUS" && r.slug === slug);
  const homicide = aus("homicide"), sexual = aus("sexual-assault"), cars = aus("motor-vehicle-theft");
  const shsNational = shs?.regions.find((r) => r.region === "AUS");

  return (
    <>
      <section className="hero compact">
        <h1>Crime and homelessness</h1>
        <p>
          Victims and offenders recorded by police, as compiled by the Australian Bureau of Statistics, and people
          without a home, from the Census and the Australian Institute of Health and Welfare. Every figure is as
          published and links to the table it came from.
        </p>
      </section>

      <section className="figures four" aria-label="Headline figures">
        <div>
          <strong>{homicide ? show(homicide.counts[vLatest]) : "–"}</strong>
          <span>{v && homicide ? `homicide victims in ${v.edition}, ${show(homicide.rates[vLatest], 1)} per 100,000 people` : `victims: ${crime.victims.error}`}</span>
        </div>
        <div>
          <strong>{sexual ? show(sexual.counts[vLatest]) : "–"}</strong>
          <span>{v && sexual ? `sexual assault victims in ${v.edition}, ${show(sexual.rates[vLatest], 1)} per 100,000, ${moved(sexual.counts[vLatest], sexual.counts[vLatest - 1] ?? null)} on ${v.years[vLatest - 1]}` : ""}</span>
        </div>
        <div>
          <strong>{cars ? show(cars.counts[vLatest]) : "–"}</strong>
          <span>{v && cars ? `motor vehicles stolen in ${v.edition}, ${moved(cars.counts[vLatest], cars.counts[vLatest - 1] ?? null)} on ${v.years[vLatest - 1]}` : ""}</span>
        </div>
        <div>
          <strong>{shsNational ? show(shsNational.clients[shs!.years.length - 1]) : "–"}</strong>
          <span>{shs && shsNational ? `people helped by a homelessness service in ${fyLabel(shs.latestYear)}` : `homelessness services: ${homelessness.shs.error}`}</span>
        </div>
      </section>

      {v ? <VictimsSection v={v} /> : <section><h2>Victims of crime</h2><Failed what="The ABS victims tables" error={crime.victims.error} /></section>}
      {o ? <OffendersSection o={o} /> : <section><h2>Offenders</h2><Failed what="The ABS offenders tables" error={crime.offenders.error} /></section>}
      <HomelessnessSection shs={shs} census={census} errors={{ shs: homelessness.shs.error, census: homelessness.census.error }} />

      <footer>
        ABS data is licensed CC BY 4.0. AIHW data is licensed CC BY 4.0. Recorded crime counts what police recorded,
        not what happened: changes in reporting and recording practice move these figures as much as changes in crime,
        and the ABS notes which states are not comparable for which offences.
      </footer>
    </>
  );
}
