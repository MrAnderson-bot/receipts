import type { Metadata } from "next";
import { tryGetSummary, rangeParams, daysFrom, type Category, type RangeParams } from "@/lib/sources/austender";
import { money, moneyFull, pct, num } from "@/lib/format";
import { RangeNav } from "@/components/RangeNav";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = rangeParams;
export const metadata: Metadata = { title: "Categories" };

const apiLink = (id: string) => `https://api.tenders.gov.au/ocds/findById/${encodeURIComponent(id)}`;

function Ranked({ items, total }: { items: Category[]; total: number }) {
  if (items.length === 0) return <p className="note">Nothing in this window.</p>;
  return (
    <ol className="rank">
      {items.map((c) => (
        <li key={c.code}>
          <span className="name">{c.name}</span>
          <span className="bar" style={{ ["--w" as any]: `${pct(c.value, items[0].value)}%` }} />
          <span className="val">
            {money(c.value)} <small>({pct(c.value, total)}% of all, {num(c.count)} contracts)</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function Page({ params }: { params: Promise<RangeParams> }) {
  const days = daysFrom(await params);
  const { data, error } = await tryGetSummary(days);

  if (error || !data) {
    return (
      <>
        <RangeNav base="/categories" days={days} />
        <section className="error">
          <h1>AusTender didn’t answer.</h1>
          <p>{error}</p>
        </section>
      </>
    );
  }

  const services = data.categories.filter((c) => c.service);
  const goods = data.categories.filter((c) => !c.service);
  const top = data.categories[0];

  return (
    <>
      <RangeNav base="/categories" days={days} />

      <section className="hero">
        <h1>
          <span className="big">{pct(data.servicesValue, data.totalValue)}%</span> of Commonwealth
          contract value in the last {days} days bought services, not goods.
        </h1>
        {top && (
          <p>
            The largest single category was {top.name.toLowerCase()}, at {money(top.value)} across{" "}
            {num(top.count)} contracts.
          </p>
        )}
      </section>

      <div className="split">
        <section>
          <h2>Services</h2>
          <p className="note">{money(data.servicesValue)} in total. Top 10 categories by contract value.</p>
          <Ranked items={services.slice(0, 10)} total={data.totalValue} />
        </section>
        <section>
          <h2>Goods</h2>
          <p className="note">{money(data.totalValue - data.servicesValue)} in total. Top 10 categories by contract value.</p>
          <Ranked items={goods.slice(0, 10)} total={data.totalValue} />
        </section>
      </div>

      <section>
        <h2>Who buys and who sells in each category</h2>
        <p className="note">The 15 largest categories, with the biggest buyer, the biggest seller and the largest single contract.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">Value</th>
                <th scope="col" className="num">Limited tender</th>
                <th scope="col">Biggest buyer</th>
                <th scope="col">Biggest seller</th>
                <th scope="col">Largest contract</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.slice(0, 15).map((c) => (
                <tr key={c.code}>
                  <td>
                    {c.name}
                    <div className="desc">UNSPSC {c.code} · {num(c.count)} contracts</div>
                  </td>
                  <td className="num">{money(c.value)}</td>
                  <td className="num">{pct(c.limitedValue, c.value)}%</td>
                  <td>
                    {c.topAgency?.name}
                    <div className="desc">{c.topAgency && money(c.topAgency.value)}</div>
                  </td>
                  <td>
                    {c.topSupplier?.name}
                    <div className="desc">{c.topSupplier && money(c.topSupplier.value)}</div>
                  </td>
                  <td>
                    {c.biggest && (
                      <>
                        <a href={apiLink(c.biggest.id)} target="_blank" rel="noreferrer">{c.biggest.id}</a>{" "}
                        {moneyFull(c.biggest.value)}
                        <div className="desc">{c.biggest.description}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Source: AusTender contract notices via the official OCDS API, licensed CC BY 3.0 AU. Each
        contract carries a UNSPSC classification code chosen by the agency; categories here are the
        code’s top-level segment. Segments 70 and above are services. Amendments are excluded.
      </footer>
    </>
  );
}
