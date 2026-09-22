import type { Metadata } from "next";
import { tryGetTransparency, type Entity } from "@/lib/sources/ato-transparency";
import { tryGetProfits } from "@/lib/sources/abs-profits";
import { money, moneyFull, pct, num, period } from "@/lib/format";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Companies" };

const abnLink = (abn: string) => `https://abr.business.gov.au/ABN/View?abn=${encodeURIComponent(abn)}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const growth = (now: number, before: number | null | undefined) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

function EntityTable({ items, caption }: { items: Entity[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="note" style={{ textAlign: "left" }}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col" className="num">Total income</th>
            <th scope="col" className="num">Taxable income</th>
            <th scope="col" className="num">Tax payable</th>
            <th scope="col" className="num">Tax as share of income</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.abn + e.name}>
              <td>
                {e.name}
                <div className="desc">
                  {e.abn ? <a href={abnLink(e.abn)} target="_blank" rel="noreferrer">ABN {e.abn}</a> : "No ABN listed"}
                </div>
              </td>
              <td className="num">{moneyFull(e.income)}</td>
              <td className="num">{e.taxable ? moneyFull(e.taxable) : "Nil"}</td>
              <td className="num">{e.tax ? moneyFull(e.tax) : "Nil"}</td>
              <td className="num">{e.income ? `${((e.tax / e.income) * 100).toFixed(1)}%` : "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Page() {
  const [transparency, profits] = await Promise.all([tryGetTransparency(), tryGetProfits()]);
  const t = transparency.data;
  const p = profits.data;

  return (
    <>
      {t ? (
        <>
          <section className="hero">
            <h1>
              <span className="big">{pct(t.totals.noTax, t.totals.entities)}%</span> of Australia’s largest
              companies reported no tax payable in {t.year}.
            </h1>
            <p>
              That’s {num(t.totals.noTax)} of {num(t.totals.entities)} companies on the Tax Office’s transparency list,
              which covers Australian public and foreign-owned companies with income of $100 million or more and
              private companies from $200 million. No tax payable is not the same as avoiding tax: losses carried
              forward, offsets and low profit years all produce it.
            </p>
          </section>

          <section className="figures four" aria-label="Totals">
            <div>
              <strong>{money(t.totals.income)}</strong>
              <span>
                total income reported
                {t.previous && growth(t.totals.income, t.previous.income) !== null && `, ${signed(growth(t.totals.income, t.previous.income)!)} on ${t.previous.year}`}
              </span>
            </div>
            <div>
              <strong>{money(t.totals.taxable)}</strong>
              <span>taxable income, the profit left after deductions</span>
            </div>
            <div>
              <strong>{money(t.totals.tax)}</strong>
              <span>
                tax payable
                {t.previous && growth(t.totals.tax, t.previous.tax) !== null && `, ${signed(growth(t.totals.tax, t.previous.tax)!)} on ${t.previous.year}`}
              </span>
            </div>
            <div>
              <strong>{money(t.noTaxIncome)}</strong>
              <span>total income of the companies that reported no tax payable</span>
            </div>
          </section>

          <section>
            <h2>Biggest taxpayers</h2>
            <EntityTable items={t.byTax} caption={`The 15 companies with the most tax payable, ${t.year}.`} />
          </section>

          <section>
            <h2>Biggest by income</h2>
            <EntityTable items={t.byIncome} caption={`The 15 companies with the highest total income, ${t.year}. Income is revenue before any costs, not profit.`} />
          </section>

          <section>
            <h2>Largest with no tax payable</h2>
            <EntityTable items={t.noTaxByIncome} caption={`The 15 highest-income companies that reported no tax payable, ${t.year}.`} />
            <p className="src">
              <a href={t.datasetUrl} target="_blank" rel="noreferrer">Australian Taxation Office, Corporate Tax Transparency, {t.year}</a>, CC BY 3.0 AU
            </p>
          </section>
        </>
      ) : (
        <section className="error">
          <h1>The Tax Office’s transparency report didn’t load.</h1>
          <p>{transparency.error}</p>
        </section>
      )}

      <section>
        <h2>Company profits by industry{p && `, ${period(p.quarter)}`}</h2>
        {p ? (
          <>
            <p className="note">
              Gross operating profits for the quarter, seasonally adjusted, with the change on the same quarter a year earlier.
              {p.total && ` All industries: ${money(p.total.value)}.`}
            </p>
            <ol className="rank">
              {p.industries.map((i) => {
                const g = growth(i.value, i.previousYear);
                return (
                  <li key={i.industry}>
                    <span className="name">{i.industry}</span>
                    <span className="bar" style={{ ["--w" as any]: `${Math.max(0, pct(i.value, p.industries[0].value))}%` }} />
                    <span className="val">{money(i.value)} {g !== null && <small>({signed(g)})</small>}</span>
                  </li>
                );
              })}
            </ol>
            <p className="src"><a href={p.sourceUrl} target="_blank" rel="noreferrer">ABS, Business Indicators</a>, CC BY 4.0</p>
          </>
        ) : (
          <p className="note">ABS business indicators didn’t load. {profits.error}</p>
        )}
      </section>

      <footer>
        The transparency list shows what each company reported to the Tax Office for its Australian operations. It covers
        Australian and foreign-owned companies alike, but the file doesn’t say which is which, so this page doesn’t either.
        Total income is gross revenue, so tax as a share of income is low for high-turnover, low-margin businesses such as
        retailers and fuel suppliers. The list is published once a year, about 18 months after the income year ends. Earnings
        that listed companies report to the ASX are not included: there is no open data source for them.
      </footer>
    </>
  );
}
