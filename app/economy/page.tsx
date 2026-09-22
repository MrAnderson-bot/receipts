import type { Metadata } from "next";
import { getIndicators, GROUPS, latest, change } from "@/lib/economy";
import { value, delta, onPrevious, period } from "@/lib/format";
import { LineChart } from "@/components/LineChart";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Economy" };

export default async function Page() {
  const results = await getIndicators();
  const byId = new Map(results.map((r) => [r.id, r]));

  return (
    <>
      <section className="hero compact">
        <h1>Economy</h1>
        <p>
          Headline indicators from the Australian Bureau of Statistics and the Reserve Bank, each
          with its history. Hover or use the arrow keys on a chart to read any point.
        </p>
      </section>

      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="cards">
            {g.ids.map((id) => {
              const r = byId.get(id);
              if (!r) return null;
              if (!r.series) {
                return (
                  <article key={id} id={id} className="card">
                    <h3>{r.label}</h3>
                    <p className="note">Source didn’t answer. {r.error}</p>
                  </article>
                );
              }
              const s = r.series;
              const d = change(s);
              return (
                <article key={id} id={id} className="card">
                  <h3>{s.label}</h3>
                  <p className="stat">
                    <strong>{value(latest(s).value, s.unit, s.decimals)}</strong>
                    <span>
                      {period(latest(s).period)}
                      {d !== null && <> · {onPrevious(delta(d, s.unit, s.decimals))}</>}
                    </span>
                  </p>
                  <LineChart series={s} />
                  <p className="note">{s.note}</p>
                  <details>
                    <summary>Show the numbers</summary>
                    <table className="mini">
                      <tbody>
                        {s.points.slice(-12).reverse().map((p) => (
                          <tr key={p.period}>
                            <td>{period(p.period)}</td>
                            <td className="num">{value(p.value, s.unit, s.decimals)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  <p className="src">
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.source}</a>
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <footer>
        ABS data is licensed CC BY 4.0. RBA data is used under the RBA’s copyright terms with
        attribution. Figures are shown as published and are revised when the publisher revises them.
      </footer>
    </>
  );
}
