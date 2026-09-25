import type { Metadata } from "next";
import { getStore, type Revision } from "@/lib/db";
import { tryGetSummary, noticeUrl, noticePageId } from "@/lib/sources/austender";
import { money, num, value, delta, period } from "@/lib/format";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Revisions" };

const DAYS = 90;

// Publisher name from a stored source string such as "ABS, Labour Force" or "Worked out from ABS Labour Force".
const publisher = (source: string) => {
  if (/^worked out/i.test(source)) return "Worked out on this site";
  const head = source.split(",")[0].trim();
  return head.replace(/^Department of /, "");
};

// Revisions are often tiny (the ABS re-seasonally-adjusts to a thousandth of a point), so show as many decimals as
// it takes for the two values to read differently, up to four.
const places = (r: Pick<Revision, "unit" | "firstValue" | "latestValue">) => {
  let d = r.unit === "%" || r.unit === "pts" ? 2 : r.unit === "ratio" ? 1 : 0;
  while (d < 4 && r.firstValue.toFixed(d) === r.latestValue.toFixed(d)) d++;
  return d;
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export default async function Page() {
  let revisions: Revision[] = [];
  let dbError: string | null = null;
  try { revisions = await getStore().revisions(); } catch (e) { dbError = e instanceof Error ? e.message : String(e); }

  const bySeries = new Map<string, { label: string; count: number }>();
  for (const r of revisions) {
    const s = bySeries.get(r.seriesId) ?? { label: r.label, count: 0 };
    s.count++; bySeries.set(r.seriesId, s);
  }
  const mostRevised = [...bySeries.values()].sort((a, b) => b.count - a.count)[0] ?? null;
  const biggest = [...revisions].sort((a, b) => Math.abs(b.latestValue - b.firstValue) / Math.abs(b.firstValue || 1) - Math.abs(a.latestValue - a.firstValue) / Math.abs(a.firstValue || 1))[0] ?? null;

  const groups = new Map<string, Revision[]>();
  for (const r of revisions) groups.set(publisher(r.source), [...(groups.get(publisher(r.source)) ?? []), r]);

  // Contract amendments: the amendment notice carries the new total; the stored row carries what was first published.
  const summary = await tryGetSummary(DAYS);
  const amended = summary.data?.amended ?? [];
  let originals = new Map<string, { value: number; published: string; pageId: string | null }>();
  try {
    const rows = await getStore().contractsById([...new Set(amended.map((a) => a.baseId))]);
    originals = new Map(rows.map((r) => [r.id, { value: r.value, published: r.published, pageId: null }]));
  } catch { /* no database on a static host: amendments still list, without the original value */ }
  const growth = amended
    .map((a) => ({ ...a, original: originals.get(a.baseId)?.value ?? null }))
    .map((a) => ({ ...a, change: a.original !== null ? a.value - a.original : null }))
    .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  const withOriginal = growth.filter((g) => g.change !== null);
  const totalGrowth = withOriginal.reduce((s, g) => s + (g.change ?? 0), 0);

  return (
    <>
      <section className="hero compact">
        <h1>Revisions</h1>
        <p>
          Official figures change after they are published. This site keeps every value it has ever seen for a
          period, so a revision by the publisher shows up as two values for the same period: what they said first
          and what they say now. Contract notices change the same way, through amendment notices.
        </p>
      </section>

      <section>
        <h2>Revised statistics</h2>
        {dbError ? (
          <p className="note">The database isn’t available on this copy of the site. {dbError}</p>
        ) : (
          <>
            <div className="figures">
              <div>
                <strong>{num(revisions.length)}</strong>
                <span>observations revised since this site started keeping history, across {num(bySeries.size)} series</span>
              </div>
              <div>
                <strong>{mostRevised ? num(mostRevised.count) : "0"}</strong>
                <span>{mostRevised ? `revisions to the most revised series, ${mostRevised.label}` : "no series revised yet"}</span>
              </div>
              <div>
                <strong>{biggest ? delta(biggest.latestValue - biggest.firstValue, biggest.unit, places(biggest)) : "–"}</strong>
                <span>{biggest ? `biggest single revision in proportion to the figure: ${biggest.label}, ${period(biggest.period)}` : "nothing to compare yet"}</span>
              </div>
            </div>
            {revisions.length === 0 && (
              <p className="note">No revisions stored yet. They appear once a publisher changes a figure this site has already stored.</p>
            )}
            {[...groups].map(([name, rows]) => (
              <div key={name}>
                <h3>{name}</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Series</th>
                        <th scope="col">Period</th>
                        <th scope="col" className="num">First published</th>
                        <th scope="col" className="num">Now</th>
                        <th scope="col" className="num">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.seriesId + r.period}>
                          <td>{r.label}<div className="desc">{r.source}</div></td>
                          <td>{period(r.period)}</td>
                          <td className="num">{value(r.firstValue, r.unit, places(r))}<div className="desc">seen {when(r.firstSeen)}</div></td>
                          <td className="num">{value(r.latestValue, r.unit, places(r))}<div className="desc">seen {when(r.latestSeen)}</div></td>
                          <td className="num">{delta(r.latestValue - r.firstValue, r.unit, places(r))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section>
        <h2>Contract amendments, last {DAYS} days</h2>
        {summary.data ? (
          <>
            <div className="figures">
              <div>
                <strong>{num(amended.length)}</strong>
                <span>amendment notices published, changing a contract already on the register</span>
              </div>
              <div>
                <strong>{withOriginal.length ? money(totalGrowth) : "n/a"}</strong>
                <span>{withOriginal.length ? `added to the ${num(withOriginal.length)} contracts whose original notice this site holds` : "original notices not stored on this copy"}</span>
              </div>
              <div>
                <strong>{growth[0]?.change !== null && growth[0] ? money(growth[0].change!) : "–"}</strong>
                <span>{growth[0]?.change !== null && growth[0] ? `largest single increase: ${growth[0].agency}` : "no amendment could be matched to its original"}</span>
              </div>
            </div>
            <p className="note">
              An amendment republishes the whole contract with its new value, so the change is the amended total
              minus what was first published. Contracts first published before this site started storing notices
              have no original to compare against and are listed without a change.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Amendment</th>
                    <th scope="col">Agency</th>
                    <th scope="col">Supplier</th>
                    <th scope="col" className="num">First published</th>
                    <th scope="col" className="num">Amended to</th>
                    <th scope="col" className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.slice(0, 40).map((g) => {
                    const pageId = noticePageId(g.awardId);
                    return (
                      <tr key={`${g.id}|${g.published}`}>
                        <td>
                          {pageId ? <a href={noticeUrl(pageId)} target="_blank" rel="noreferrer">{g.id}</a> : g.id}
                          <div className="desc">{g.description}</div>
                        </td>
                        <td>{g.agency}</td>
                        <td>{g.supplier}</td>
                        <td className="num">{g.original !== null ? money(g.original) : "not stored"}</td>
                        <td className="num">{money(g.value)}</td>
                        <td className="num">{g.change !== null ? `${g.change < 0 ? "−" : "+"}${money(Math.abs(g.change))}` : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="note">AusTender didn’t answer. {summary.error}</p>
        )}
      </section>

      <footer>
        Statistics are stored each day from the ABS, RBA, Treasury, Finance and Home Affairs; a period with two
        stored values is a revision by the publisher, not by this site. Contract amendments come from AusTender
        (CC BY 3.0 AU), matched by contract number to the original notice.
      </footer>
    </>
  );
}
