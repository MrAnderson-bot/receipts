import type { Metadata } from "next";
import { tryGetGrants, GRANT_DEADLINE_DAYS } from "@/lib/sources/grantconnect";
import { rangeParams, daysFrom, type RangeParams } from "@/lib/sources/austender";
import { money, moneyFull, pct, num } from "@/lib/format";
import { RangeNav } from "@/components/RangeNav";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = rangeParams;
export const metadata: Metadata = { title: "Grants" };

const recordLink = (id: string) => `https://www.grants.gov.au/Search/KeywordSearch?keyword=${encodeURIComponent(id)}`;

type Bucket = { name: string; value: number; count: number };

function Ranked({ items, sub }: { items: (Bucket & { sub?: string })[]; sub?: (b: Bucket) => string }) {
  if (items.length === 0) return <p className="note">Nothing in this window.</p>;
  return (
    <ol className="rank">
      {items.map((b) => (
        <li key={b.name}>
          <span className="name">{b.name} {sub && <small>{sub(b)}</small>}</span>
          <span className="bar" style={{ ["--w" as any]: `${pct(b.value, items[0].value)}%` }} />
          <span className="val">{money(b.value)} <small>({num(b.count)})</small></span>
        </li>
      ))}
    </ol>
  );
}

export default async function Page({ params }: { params: Promise<RangeParams> }) {
  const days = daysFrom(await params);
  const { data, error } = await tryGetGrants(days);
  const filter = <RangeNav base="/grants" days={days} label="Grants published in the last" />;

  if (error || !data) {
    return (
      <>
        {filter}
        <section className="error">
          <h1>GrantConnect didn’t answer.</h1>
          <p>{error}</p>
        </section>
      </>
    );
  }

  return (
    <>
      {filter}

      <section className="hero">
        <h1>
          <span className="big">{money(data.totalValue)}</span> in Commonwealth grants was published in the
          last {days} days.
        </h1>
        <p>
          Across {num(data.count)} grant awards. Grants are money given to organisations and people to
          deliver something; they are separate from the contracts on the spending page.
        </p>
      </section>

      <section className="figures" aria-label="Totals">
        <div>
          <strong>{pct(data.nonCompetitiveValue, data.totalValue)}%</strong>
          <span>of that value was awarded without a competitive process, including one-off grants</span>
        </div>
        <div>
          <strong>{pct(data.lateCount, data.knownStartCount)}%</strong>
          <span>of awards appeared more than {GRANT_DEADLINE_DAYS} days after the grant started ({num(data.lateCount)} of {num(data.knownStartCount)})</span>
        </div>
        <div>
          <strong>{money(data.adHocValue)}</strong>
          <span>went out as one-off or ad hoc grants, outside an established program</span>
        </div>
      </section>

      <div className="split">
        <section>
          <h2>What the grants fund</h2>
          <p className="note">Top 10 categories by value, as classified by the granting agency.</p>
          <Ranked items={data.categories.slice(0, 10)} />
        </section>
        <section>
          <h2>How recipients were chosen</h2>
          <p className="note">Selection process recorded for each award, by value.</p>
          <Ranked items={data.selection} />
        </section>
      </div>

      <div className="split">
        <section>
          <h2>Biggest granting agencies</h2>
          <Ranked items={data.topAgencies} />
        </section>
        <section>
          <h2>Biggest recipients</h2>
          <p className="note">Grouped by ABN. Individuals and confidential recipients are not named in the source.</p>
          <Ranked items={data.topRecipients} />
        </section>
      </div>

      <section>
        <h2>Where the grants are delivered</h2>
        <Ranked items={data.states} />
      </section>

      <section>
        <h2>Largest grants</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Grant</th>
                <th scope="col">Agency</th>
                <th scope="col">Recipient</th>
                <th scope="col">Category</th>
                <th scope="col">Selection</th>
                <th scope="col" className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.biggest.map((g) => (
                <tr key={g.id}>
                  <td>
                    <a href={recordLink(g.id)} target="_blank" rel="noreferrer">{g.id}</a>
                    <div className="desc">{g.program}</div>
                  </td>
                  <td>{g.agency}</td>
                  <td>{g.recipient}</td>
                  <td>{g.category}</td>
                  <td>
                    <span className={/non-competitive/i.test(g.selection) || g.adHoc ? "tag limited" : "tag"}>{g.selection}</span>
                    {g.adHoc && <span className="tag">Ad hoc</span>}
                    {g.lateDays !== null && g.lateDays > 0 && <span className="tag late">{num(g.lateDays)}d late</span>}
                  </td>
                  <td className="num">{moneyFull(g.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Source: GrantConnect’s public Grant Award Published report, licensed CC BY 3.0 AU.{" "}
        <a href={data.reportUrl} target="_blank" rel="noreferrer">Open this exact report on GrantConnect.</a>{" "}
        “Late” means published more than {GRANT_DEADLINE_DAYS} days after the grant’s start date. The rule counts
        from the day the grant agreement takes effect, which isn’t published, so the start date stands in
        for it. Refreshed at most every six hours.
      </footer>
    </>
  );
}
