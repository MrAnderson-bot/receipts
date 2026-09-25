import type { Metadata } from "next";
import { tryGetExpenses, QUARTERS } from "@/lib/sources/ipea";
import { money, moneyFull, pct, num } from "@/lib/format";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Expenses" };

type Bucket = { name: string; value: number; count: number };

function Ranked({ items, sub }: { items: Bucket[]; sub?: (b: Bucket) => string | null }) {
  if (items.length === 0) return <p className="note">Nothing in this quarter.</p>;
  return (
    <ol className="rank">
      {items.map((b) => {
        const s = sub?.(b);
        return (
          <li key={b.name}>
            <span className="name">{b.name} {s && <small>{s}</small>}</span>
            <span className="bar" style={{ ["--w" as any]: `${pct(b.value, items[0].value)}%` }} />
            <span className="val">{money(b.value)} <small>({num(b.count)})</small></span>
          </li>
        );
      })}
    </ol>
  );
}

// "+4.5% on a year earlier", or "−2.1%", or null when there is nothing to compare with.
function onYearEarlier(now: number, before: number | null | undefined): string | null {
  if (before === null || before === undefined || before === 0) return null;
  const change = ((now - before) / before) * 100;
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${sign}${Math.abs(change).toFixed(1)}% on a year earlier`;
}

export default async function Page() {
  const { data, error } = await tryGetExpenses();

  if (error || !data) {
    return (
      <section className="error">
        <h1>IPEA’s expenditure reports didn’t load.</h1>
        <p>{error}</p>
      </section>
    );
  }

  const { latest, yearEarlier } = data;
  const perPerson = latest.people ? latest.total / latest.people : 0;
  const biggestCategory = data.categories[0];

  return (
    <>
      <section className="hero">
        <h1>
          <span className="big">{money(latest.total)}</span> in work expenses was claimed by parliamentarians
          in {latest.period}.
        </h1>
        <p>
          Across {num(latest.rows)} expense lines for {num(latest.people)} current and former parliamentarians and
          office holders, as reported by the Independent Parliamentary Expenses Authority.
          {yearEarlier && ` The same quarter a year earlier (${yearEarlier.period}) came to ${money(yearEarlier.total)}.`}
        </p>
      </section>

      <section className="figures" aria-label="Totals">
        <div>
          <strong>{onYearEarlier(latest.total, yearEarlier?.total)?.split(" on ")[0] ?? "n/a"}</strong>
          <span>{yearEarlier ? `change on ${yearEarlier.period}, the same quarter a year earlier` : "no year-earlier quarter to compare with"}</span>
        </div>
        <div>
          <strong>{money(perPerson)}</strong>
          <span>average per person for the quarter</span>
        </div>
        <div>
          <strong>{biggestCategory ? `${pct(biggestCategory.value, latest.total)}%` : "n/a"}</strong>
          <span>{biggestCategory ? `went on the largest category: ${biggestCategory.name.toLowerCase()}` : "no categories found"}</span>
        </div>
      </section>

      <div className="split">
        <section>
          <h2>What the money went on</h2>
          <p className="note">IPEA’s high-level categories for {latest.period}, with the same quarter a year earlier for comparison.</p>
          <Ranked items={data.categories} sub={(b) => onYearEarlier(b.value, (b as (typeof data.categories)[number]).yearEarlier)} />
        </section>
        <section>
          <h2>In more detail</h2>
          <p className="note">Top 12 sub-categories. Office facilities have no sub-category in the source and are shown under their own name.</p>
          <Ranked items={data.subCategories} />
        </section>
      </div>

      <div className="split">
        <section>
          <h2>By party</h2>
          <p className="note">As recorded against each person. Party size drives most of the difference.</p>
          <Ranked items={data.parties} />
        </section>
        <section>
          <h2>By home state or territory</h2>
          <Ranked items={data.states} />
        </section>
      </div>

      <section>
        <h2>Quarter by quarter</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Quarter</th>
                <th scope="col" className="num">Expense lines</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...data.quarters].reverse().map((q) => (
                <tr key={q.id}>
                  <td>{q.period}</td>
                  <td className="num">{num(q.rows)}</td>
                  <td className="num">{moneyFull(q.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">The latest {QUARTERS} quarters IPEA has published. Figures for a quarter can change after publication when adjustments and repayments are processed.</p>
      </section>

      <section>
        <h2>Biggest claims by person, {latest.period}</h2>
        <p className="note">Top 20 by total. Each name links to IPEA’s full report for that person and quarter.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Party</th>
                <th scope="col">Electorate or state</th>
                <th scope="col">Largest categories</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((p) => (
                <tr key={p.reportUrl}>
                  <td>
                    <a href={p.reportUrl} target="_blank" rel="noreferrer">{p.name}</a>
                    {p.role !== "Parliamentarian" && <div className="desc">{p.role}</div>}
                  </td>
                  <td>{p.party || "—"}</td>
                  <td>{p.electorate ? `${p.electorate}, ${p.state}` : p.state}</td>
                  <td>
                    <div className="desc">
                      {p.categories.slice(0, 3).map((c) => `${c.name} ${money(c.value)}`).join(" · ")}
                    </div>
                  </td>
                  <td className="num">{moneyFull(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Largest single lines, {latest.period}</h2>
        <p className="note">
          The 25 biggest lines in the quarter. Lines described as “Aggregated” are IPEA’s own totals for a person and category,
          published in place of individual transactions.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Category</th>
                <th scope="col">Description</th>
                <th scope="col">When and where</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.biggest.map((l) => (
                <tr key={l.uniqueId}>
                  <td>
                    <a href={l.reportUrl} target="_blank" rel="noreferrer">{l.name}</a>
                    <div className="desc">{l.party}</div>
                  </td>
                  <td>
                    {l.category}
                    {l.subCategory && l.subCategory !== l.category && <div className="desc">{l.subCategory}</div>}
                  </td>
                  <td><div className="desc">{l.description || "—"}</div></td>
                  <td>
                    <div className="desc">
                      {[l.fromDate && (l.toDate && l.toDate !== l.fromDate ? `${l.fromDate} to ${l.toDate}` : l.fromDate),
                        l.fromLocation && l.toLocation ? `${l.fromLocation} to ${l.toLocation}` : l.toLocation || l.fromLocation,
                        l.nights && `${l.nights} nights`].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="num">{moneyFull(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Source: Independent Parliamentary Expenses Authority, quarterly expenditure reports published on data.gov.au under
        a Creative Commons Attribution licence.{" "}
        <a href={latest.datasetUrl} target="_blank" rel="noreferrer">Open the {latest.period} dataset</a> or{" "}
        <a href={latest.url} target="_blank" rel="noreferrer">download the exact CSV</a> these figures were read from. Every line
        in it is stored unchanged in this site’s database. Amounts are as IPEA published them, including negative lines for
        credits and repayments. Refreshed at most every six hours.
      </footer>
    </>
  );
}
