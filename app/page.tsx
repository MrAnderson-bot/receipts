import Link from "next/link";
import { getIndicators, HEADLINE_IDS, latest, change } from "@/lib/economy";
import { tryGetSummary } from "@/lib/sources/austender";
import { tryGetRevenue } from "@/lib/sources/treasury";
import { money, pct, num, value, delta, onPrevious, period } from "@/lib/format";
import { Spark } from "@/components/Spark";

export const revalidate = 3600;

const SPENDING_DAYS = 7; // keeps the overview quick; the spending page has 30 and 90

export default async function Page() {
  const [indicators, spending, revenue] = await Promise.all([
    getIndicators(HEADLINE_IDS),
    tryGetSummary(SPENDING_DAYS),
    tryGetRevenue(),
  ]);
  const rev = revenue.data;
  const revTotal = rev?.total.find((t) => t.year === rev.latestActual)?.value ?? 0;
  const revShare = rev?.shareOfGdp.find((t) => t.year === rev.latestActual)?.value ?? 0;
  const ordered = HEADLINE_IDS.map((id) => indicators.find((r) => r.id === id)!).filter(Boolean);
  const s = spending.data;
  const topCategory = s?.categories[0];

  return (
    <>
      <section className="hero">
        <h1>The Australian economy, from the source.</h1>
        <p>
          Every figure here is pulled live from an official publisher and links back to the record
          it came from.
        </p>
      </section>

      <section>
        <h2>Where things stand</h2>
        <div className="tiles">
          {ordered.map((r) =>
            r.series ? (
              <Link key={r.id} href={`/economy#${r.id}`} className="tile">
                <span className="label">{r.series.label}</span>
                <strong>{value(latest(r.series).value, r.series.unit, r.series.decimals)}</strong>
                <span className="sub">
                  {period(latest(r.series).period)}
                  {change(r.series) !== null && (
                    <> · {onPrevious(delta(change(r.series)!, r.series.unit, r.series.decimals))}</>
                  )}
                </span>
                <Spark points={r.series.points} />
              </Link>
            ) : (
              <div key={r.id} className="tile">
                <span className="label">{r.label}</span>
                <strong>n/a</strong>
                <span className="sub">Source didn’t answer. {r.error}</span>
              </div>
            ),
          )}
        </div>
        <p className="more"><Link href="/economy">All indicators with history</Link></p>
      </section>

      <section>
        <h2>Commonwealth revenue{rev && `, ${rev.latestActual}`}</h2>
        {rev ? (
          <div className="figures">
            <div>
              <strong>{money(revTotal * 1_000_000)}</strong>
              <span>collected from every source</span>
            </div>
            <div>
              <strong>{revShare.toFixed(1)}%</strong>
              <span>of the whole economy</span>
            </div>
            <div>
              <strong>{pct(rev.lines[0].series.find((p) => p.year === rev.latestActual)?.value ?? 0, revTotal)}%</strong>
              <span>came from the largest source: {rev.lines[0].name.toLowerCase()}</span>
            </div>
          </div>
        ) : (
          <p className="note">Treasury’s revenue tables didn’t load. {revenue.error}</p>
        )}
        <p className="more">
          <Link href="/revenue">Every source of revenue</Link>
          <Link href="/budget">Where the Budget sends it, and the balance</Link>
        </p>
      </section>

      <section>
        <h2>Commonwealth spending, last {SPENDING_DAYS} days</h2>
        {s ? (
          <div className="figures">
            <div>
              <strong>{money(s.totalValue)}</strong>
              <span>committed across {num(s.contracts.length)} new contracts</span>
            </div>
            <div>
              <strong>{pct(s.limitedValue, s.totalValue)}%</strong>
              <span>of that value went through limited tender, without open competition</span>
            </div>
            <div>
              <strong>{topCategory ? money(topCategory.value) : "n/a"}</strong>
              <span>{topCategory ? `went to the largest category: ${topCategory.name}` : "no categories found"}</span>
            </div>
          </div>
        ) : (
          <p className="note">AusTender didn’t answer. {spending.error}</p>
        )}
        <p className="more">
          <Link href="/spending">Agencies, suppliers and contracts</Link>
          <Link href="/categories">What the money is buying</Link>
          <Link href="/grants">Grants</Link>
          <Link href="/states">State contracts</Link>
        </p>
      </section>

      <footer>
        Sources: Australian Bureau of Statistics, Reserve Bank of Australia, Treasury, AusTender and GrantConnect.
        See <Link href="/sources">the sources page</Link> for every feed, its licence and what isn’t connected yet.
      </footer>
    </>
  );
}
