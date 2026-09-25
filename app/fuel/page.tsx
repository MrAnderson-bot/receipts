import type { Metadata } from "next";
import { tryGetFuel, keyNeeded, FUEL_CODES, FUEL_LABELS, SHOWN, NOT_CONNECTED, type FuelPage, type FuelType } from "@/lib/sources/fuel";
import { PLAUSIBLE } from "@/lib/sources/fuel/types";
import { num, period } from "@/lib/format";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Fuel" };

// 195.9 -> "195.9¢", the way every scheme and every forecourt shows it.
const cents = (c: number) => `${c.toFixed(1)}¢`;

function StateSection({ data }: { data: FuelPage }) {
  const stat = (fuel: FuelType) => data.stats.find((s) => s.fuel === fuel);
  const u91 = stat("U91"), dl = stat("DL");
  const shown = SHOWN.filter((f) => stat(f));
  return (
    <section id={data.code}>
      <h2>{data.name}</h2>
      <p className="note">
        {data.live ? "Live prices" : "Prices from the latest file"}, {period(data.date)}, {num(data.stationCount)} stations. {data.coverage}
        {data.implausible > 0 && ` ${num(data.implausible)} reported ${data.implausible === 1 ? "price" : "prices"} outside ${PLAUSIBLE[0]}¢ to ${PLAUSIBLE[1]}¢ a litre, almost certainly entry errors, are left out of these figures but kept in the stored data.`}
      </p>
      <div className="figures four">
        <div><strong>{u91 ? cents(u91.median) : "n/a"}</strong><span>median unleaded 91 per litre</span></div>
        <div><strong>{u91 ? cents(u91.cheapest) : "n/a"}</strong><span>cheapest unleaded 91 in the state</span></div>
        <div><strong>{dl ? cents(dl.median) : "n/a"}</strong><span>median diesel per litre</span></div>
        <div><strong>{dl ? cents(dl.cheapest) : "n/a"}</strong><span>cheapest diesel in the state</span></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Fuel</th>
              <th scope="col" className="num">Stations</th>
              <th scope="col" className="num">Cheapest</th>
              <th scope="col" className="num">Median</th>
              <th scope="col" className="num">Dearest</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const s = stat(f)!;
              return (
                <tr key={f}>
                  <td>{s.label}<div className="desc">{s.raw}</div></td>
                  <td className="num">{num(s.count)}</td>
                  <td className="num">{cents(s.cheapest)}</td>
                  <td className="num">{cents(s.median)}</td>
                  <td className="num">{cents(s.dearest)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="split">
        {(["U91", "DL"] as FuelType[]).map((f) => {
          const list = data.cheapest[f] ?? [];
          if (list.length === 0) return null;
          return (
            <section key={f}>
              <h3>Cheapest {FUEL_LABELS[f].toLowerCase()}</h3>
              <div className="table-wrap">
                <table className="mini">
                  <tbody>
                    {list.map((p) => (
                      <tr key={`${p.siteId}-${p.fuel}`}>
                        <td>
                          {p.name}
                          <div className="desc">{[p.brand, p.suburb].filter(Boolean).join(", ")}</div>
                        </td>
                        <td className="num">{cents(p.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
      <p className="src">
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.sourceName}</a>. {data.licence}.
      </p>
    </section>
  );
}

export default async function Page() {
  const results = await Promise.all(FUEL_CODES.map((c) => tryGetFuel(c)));
  const loaded = results.filter((r) => r.data).map((r) => r.data!);
  const waiting = FUEL_CODES.map((code, i) => ({ code, error: results[i].error })).filter((r) => r.error);

  return (
    <>
      <section className="hero">
        <h1>
          Fuel prices, {loaded.length ? `${loaded.length} of ${FUEL_CODES.length} states` : "from the state schemes"}.
        </h1>
        <p>
          Every state with a fuel price reporting scheme makes retailers report their prices. This page reads those
          schemes directly: today's median and cheapest price per litre, and the cheapest stations. Every figure links
          to the scheme it came from.
        </p>
      </section>

      {loaded.length > 0 && (
        <div className="filters">
          <span>Jump to</span>
          <nav aria-label="State">
            {loaded.map((d) => <a key={d.code} href={`#${d.code}`}>{d.code}</a>)}
          </nav>
        </div>
      )}

      {loaded.map((d) => <StateSection key={d.code} data={d} />)}

      {waiting.length > 0 && (
        <section>
          <h2>Not loaded</h2>
          <ul className="plain">
            {waiting.map((w) => (
              <li key={w.code}>
                <strong>{w.code}</strong>
                <p>{w.error}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Not connected</h2>
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
        Prices are cents per litre as reported to each scheme. Schemes that need a key: {FUEL_CODES.filter((c) => keyNeeded(c)).join(", ") || "none"}.
        Figures refresh once a day.
      </footer>
    </>
  );
}
