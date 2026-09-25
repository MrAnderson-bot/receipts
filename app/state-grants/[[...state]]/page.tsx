import type { Metadata } from "next";
import Link from "next/link";
import { tryGetStateGrants, STATE_GRANT_CODES, NOT_CONNECTED, type ConnectedCode } from "@/lib/sources/state-grants";
import { money, moneyFull, pct, num, period } from "@/lib/format";

export const revalidate = 86_400;
export const dynamicParams = false;
export const metadata: Metadata = { title: "State grants" };

// /state-grants shows the first state; /state-grants/QLD and any later feed are pre-rendered too.
type Params = { state?: string[] };
export const generateStaticParams = (): Params[] => [{ state: [] }, ...STATE_GRANT_CODES.map((c) => ({ state: [c] }))];

type Bucket = { name: string; value: number; count: number };

function Ranked({ items }: { items: Bucket[] }) {
  if (items.length === 0) return <p className="note">Not published by this state.</p>;
  return (
    <ol className="rank">
      {items.map((b) => (
        <li key={b.name}>
          <span className="name">{b.name}</span>
          <span className="bar" style={{ ["--w" as any]: `${pct(b.value, items[0].value)}%` }} />
          <span className="val">{money(b.value)} <small>({num(b.count)})</small></span>
        </li>
      ))}
    </ol>
  );
}

const change = (now: number, before: number) => {
  const d = now - before;
  if (Math.abs(d) < 1) return "unchanged";
  return `${d > 0 ? "up" : "down"} ${money(Math.abs(d))} (${d > 0 ? "+" : "−"}${Math.abs(pct(d, before))}%)`;
};

export default async function Page({ params }: { params: Promise<Params> }) {
  const raw = ((await params).state?.[0] ?? "").toUpperCase();
  const code: ConnectedCode = (STATE_GRANT_CODES as string[]).includes(raw) ? (raw as ConnectedCode) : STATE_GRANT_CODES[0];
  const { data, error } = await tryGetStateGrants(code);

  return (
    <>
      <div className="filters">
        <span>State grant payments from</span>
        <nav aria-label="State">
          {STATE_GRANT_CODES.map((c) => (
            <Link key={c} href={c === STATE_GRANT_CODES[0] ? "/state-grants" : `/state-grants/${c}`} aria-current={c === code ? "page" : undefined}>{c}</Link>
          ))}
        </nav>
      </div>

      {error || !data ? (
        <section className="error">
          <h1>{code} grant data didn’t load.</h1>
          <p>{error}</p>
        </section>
      ) : (
        <>
          <section className="hero">
            <h1>
              <span className="big">{money(data.totalValue)}</span> {data.subject} in {period(data.year)}.
            </h1>
            <p>
              Across {num(data.count)} payment lines. {data.coverage}
              {data.previous && ` Total ${change(data.totalValue, data.previous.totalValue)} on ${period(data.previous.year)}, when ${num(data.previous.count)} lines added up to ${money(data.previous.totalValue)}.`}
            </p>
          </section>

          <section className="figures" aria-label="Totals">
            <div>
              <strong>{pct(data.grantValue, data.totalValue)}%</strong>
              <span>of the total was grants proper. The rest bought frontline services, or went out as concessions and loans</span>
            </div>
            <div>
              <strong>{money(data.pooledValue)}</strong>
              <span>went to individuals and households, pooled by program because the recipients aren’t named</span>
            </div>
            <div>
              <strong>{pct(data.commonwealthValue, data.totalValue)}%</strong>
              <span>was wholly Commonwealth money passed on by the state, by the state’s own labelling</span>
            </div>
          </section>

          <div className="split">
            <section>
              <h2>Biggest funding agencies</h2>
              <Ranked items={data.topAgencies} />
              {data.unknownAgencyCodes.length > 0 && (
                <p className="note" style={{ marginTop: 12 }}>
                  Shown as published, no full name known for: {data.unknownAgencyCodes.join(", ")}.
                </p>
              )}
            </section>
            <section>
              <h2>Biggest recipients</h2>
              <p className="note">Grouped by ABN. Pooled individual recipients are left out.</p>
              <Ranked items={data.topRecipients} />
            </section>
          </div>

          <div className="split">
            <section>
              <h2>Biggest programs</h2>
              <Ranked items={data.topPrograms} />
            </section>
            <section>
              <h2>What the money is for</h2>
              <p className="note">Category, as classified by the funding agency.</p>
              <Ranked items={data.categories} />
            </section>
          </div>

          <div className="split">
            <section>
              <h2>Who receives it</h2>
              <Ranked items={data.recipientTypes} />
            </section>
            <section>
              <h2>Kind of assistance</h2>
              <Ranked items={data.assistanceTypes} />
              <h2 style={{ marginTop: 32 }}>Whose money</h2>
              <p className="note">Funding source as the state records it.</p>
              <Ranked items={data.fundingSources} />
            </section>
          </div>

          <section>
            <h2>Largest payments</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Program</th>
                    <th scope="col">Agency</th>
                    <th scope="col">Recipient</th>
                    <th scope="col">Type</th>
                    <th scope="col">Agreement</th>
                    <th scope="col" className="num">Paid in year</th>
                  </tr>
                </thead>
                <tbody>
                  {data.biggest.map((g, i) => (
                    <tr key={`${i}-${g.program}-${g.recipient}`}>
                      <td>
                        {g.program}
                        <div className="desc">{g.subProgram || g.purpose.slice(0, 140)}</div>
                      </td>
                      <td>{g.agency}</td>
                      <td>
                        {g.pooled ? "Individuals, pooled" : g.recipient}
                        <div className="desc">{g.pooled ? `Published as “${g.recipient}”` : g.recipientAbn ? `ABN ${g.recipientAbn}` : "No ABN published"}</div>
                      </td>
                      <td><span className={/^grant$/i.test(g.assistance) ? "tag" : "tag limited"}>{g.assistance}</span></td>
                      <td>
                        {g.start ? period(g.start) : "n/a"}{g.end && ` to ${period(g.end)}`}
                        {g.agreementTotal !== null && g.agreementTotal > g.value && <div className="desc">{moneyFull(g.agreementTotal)} to date</div>}
                      </td>
                      <td className="num">{moneyFull(g.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="src">
              <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.sourceName}</a>, {data.licence}.{" "}
              <a href={data.fileUrl} target="_blank" rel="noreferrer">Open the source data.</a>
            </p>
          </section>
        </>
      )}

      <section>
        <h2>States without usable data</h2>
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
        State grants are money a state body pays out to organisations, councils and people, separate from the state
        contracts on the States page and from the Commonwealth grants on the Grants page. Commonwealth grants a state
        passes on can appear in both. Each state defines and reports grants differently, and Western Australia’s
        figures are Lotterywest’s alone, so figures are not comparable across states.
      </footer>
    </>
  );
}
