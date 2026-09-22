import type { Metadata } from "next";
import Link from "next/link";
import { tryGetState, STATE_CODES, NOT_CONNECTED, type StateCode } from "@/lib/sources/states";
import { money, moneyFull, pct, num, period } from "@/lib/format";

export const revalidate = 86_400;
export const dynamicParams = false;
export const metadata: Metadata = { title: "States" };

// /states shows the first state; /states/QLD and the rest are pre-rendered too.
type Params = { state?: string[] };
export const generateStaticParams = (): Params[] => [{ state: [] }, ...STATE_CODES.map((c) => ({ state: [c] }))];

type Bucket = { name: string; value: number; count: number };

// NSW and the ACT don't publish how work was awarded, which leaves a single "Not stated" row.
const hasMethods = (methods: Bucket[]) => methods.some((m) => m.name !== "Not stated");

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

export default async function Page({ params }: { params: Promise<Params> }) {
  const raw = ((await params).state?.[0] ?? "").toUpperCase();
  const code: StateCode = (STATE_CODES as string[]).includes(raw) ? (raw as StateCode) : STATE_CODES[0];
  const { data, error } = await tryGetState(code);

  return (
    <>
      <div className="filters">
        <span>State and territory data from</span>
        <nav aria-label="State">
          {STATE_CODES.map((c) => (
            <Link key={c} href={c === STATE_CODES[0] ? "/states" : `/states/${c}`} aria-current={c === code ? "page" : undefined}>{c}</Link>
          ))}
        </nav>
      </div>

      {error || !data ? (
        <section className="error">
          <h1>{code} contract data didn’t load.</h1>
          <p>{error}</p>
        </section>
      ) : (
        <>
          <section className="hero">
            <h1>
              <span className="big">{money(data.totalValue)}</span> in {data.name} government {data.noun}.
            </h1>
            <p>{data.period}, across {num(data.count)} {data.noun}. {data.coverage}</p>
          </section>

          <section className="figures" aria-label="Totals">
            <div>
              {hasMethods(data.methods) ? (
                <>
                  <strong>{pct(data.openValue, data.totalValue)}%</strong>
                  <span>of that value was awarded through an open or public process</span>
                </>
              ) : (
                <>
                  <strong>{money(data.totalValue / Math.max(1, data.count))}</strong>
                  <span>average value. This source doesn’t say how the work was awarded</span>
                </>
              )}
            </div>
            <div>
              <strong>{data.topAgencies[0] ? money(data.topAgencies[0].value) : "n/a"}</strong>
              <span>came from the biggest buyer{data.topAgencies[0] && `: ${data.topAgencies[0].name}`}</span>
            </div>
            <div>
              <strong>{num(data.filesRead)}</strong>
              <span>
                source {data.filesRead === 1 ? "file" : "files"} read
                {data.filesSkipped.length > 0 && `, ${num(data.filesSkipped.length)} left out as unreadable`}
              </span>
            </div>
          </section>

          <div className="split">
            <section>
              <h2>Biggest buyers</h2>
              <Ranked items={data.topAgencies} />
            </section>
            <section>
              <h2>Biggest suppliers</h2>
              <Ranked items={data.topSuppliers} />
            </section>
          </div>

          {(hasMethods(data.methods) || data.categories.length > 0) && (
            <div className="split">
              {hasMethods(data.methods) && (
                <section>
                  <h2>How the work was awarded</h2>
                  <Ranked items={data.methods} />
                </section>
              )}
              {data.categories.length > 0 && (
                <section>
                  <h2>What was bought</h2>
                  <Ranked items={data.categories} />
                </section>
              )}
            </div>
          )}

          <section>
            <h2>Largest {data.noun}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Agency</th>
                    <th scope="col">Supplier</th>
                    <th scope="col">Method</th>
                    <th scope="col">Awarded</th>
                    <th scope="col" className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ACT invoices can share a contract number and supplier, so the position makes the key unique. */}
                  {data.biggest.map((c, i) => (
                    <tr key={`${i}-${c.id}`}>
                      <td>
                        {c.description || c.id}
                        <div className="desc">{c.id}</div>
                      </td>
                      <td>{c.agency}</td>
                      <td>{c.supplier}</td>
                      <td>{c.method && <span className="tag">{c.method}</span>}</td>
                      <td>{period(c.awarded)}</td>
                      <td className="num">{moneyFull(c.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="src">
              <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.sourceName}</a>, {data.licence}
            </p>
          </section>

          {data.filesSkipped.length > 0 && (
            <section>
              <details>
                <summary>Files left out ({num(data.filesSkipped.length)})</summary>
                <ul className="plain">
                  {data.filesSkipped.map((f, i) => (
                    <li key={`${i}-${f.name}`}>{f.name}<p>{f.reason}</p></li>
                  ))}
                </ul>
              </details>
            </section>
          )}
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
        State figures are not comparable with each other or with the Commonwealth pages: each state sets its
        own reporting threshold, covers a different period and defines contract value differently.
      </footer>
    </>
  );
}
