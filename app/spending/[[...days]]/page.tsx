import type { Metadata } from "next";
import { tryGetSummary, rangeParams, daysFrom, DEADLINE_DAYS, type Summary, type RangeParams } from "@/lib/sources/austender";
import { money, moneyFull, pct, num } from "@/lib/format";
import { DailyChart } from "@/components/DailyChart";
import { RangeNav } from "@/components/RangeNav";

export const revalidate = 3600; // refresh from AusTender at most once an hour
export const dynamicParams = false; // only the ranges below exist
export const generateStaticParams = rangeParams;
export const metadata: Metadata = { title: "Spending" };

const apiLink = (id: string) => `https://api.tenders.gov.au/ocds/findById/${encodeURIComponent(id)}`;

// AusTender timestamps are UTC; show the date as it reads in Canberra.
const dayFormat = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });
const day = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? dayFormat.format(new Date(iso)) : "not recorded");

export default async function Page({ params }: { params: Promise<RangeParams> }) {
  const days = daysFrom(await params);
  const { data, error } = await tryGetSummary(days);

  return (
    <>
      <RangeNav base="/spending" days={days} />

      {error || !data ? (
        <section className="error">
          <h1>AusTender didn’t answer.</h1>
          <p>{error}</p>
          <p>The page tries again on the next refresh. If it keeps failing, the API may be down.</p>
        </section>
      ) : (
        <Dashboard data={data} days={days} />
      )}

      <footer>
        Source: AusTender contract notices via the official OCDS API, licensed CC BY 3.0 AU.
        Figures cover notices published in the selected window, excluding amendments.
        “Late” means published more than {DEADLINE_DAYS} days after the contract’s start date. The
        rule counts from the day a contract is entered into, which AusTender doesn’t publish, so
        the start date stands in for it.
      </footer>
    </>
  );
}

function Dashboard({ data, days }: { data: Summary; days: number }) {
  const latePct = pct(data.lateCount, data.knownStartCount);
  // Defence records Foreign Military Sales under the name of the payment account, not a company.
  const isFms = (name: string) => /^FMS ACCOUNT\b/i.test(name);
  const fmsNote = (
    <p>
      “FMS Account” is Foreign Military Sales, a United States Government program. Defence buys the
      equipment from the US Government, which buys it from the manufacturer. The supplier name is shown as
      Defence published it: it identifies the account the payments go to, not the company that makes the
      equipment, and the manufacturer is not on the record. These purchases are always limited tender,
      because there is only one seller.
    </p>
  );
  return (
    <>
      <section className="hero">
        <h1>
          <span className="big">{latePct}%</span> of Commonwealth contracts published in the last{" "}
          {days} days appeared more than {DEADLINE_DAYS} days after they started.
        </h1>
        <p>
          That’s {num(data.lateCount)} of {num(data.knownStartCount)} contracts with a start date on
          record. Agencies have {DEADLINE_DAYS} days to report a contract.
        </p>
      </section>

      <section className="figures four" aria-label="Totals">
        <div>
          <strong>{money(data.totalValue)}</strong>
          <span>committed across {num(data.contracts.length)} new contracts</span>
        </div>
        <div>
          <strong>{pct(data.limitedValue, data.totalValue)}%</strong>
          <span>of that value went through limited tender, without open competition</span>
        </div>
        <div>
          <strong>{pct(data.overseasValue, data.totalValue)}%</strong>
          <span>of that value went to suppliers with an overseas address</span>
        </div>
        <div>
          <strong>{num(data.amendments)}</strong>
          <span>amendments to existing contracts published in the same period</span>
        </div>
      </section>

      <section>
        <h2>Money published per day</h2>
        <DailyChart data={data.daily} />
      </section>

      <div className="split">
        <section>
          <h2>Slowest to report</h2>
          <p className="note">Share of each agency’s contracts published late. Agencies with at least 5 contracts.</p>
          <ol className="rank">
            {data.lateAgencies.map((a) => (
              <li key={a.name}>
                <span className="name">{a.name}</span>
                <span className="bar" style={{ ["--w" as any]: `${pct(a.late, a.total)}%` }} />
                <span className="val late">
                  {pct(a.late, a.total)}% <small>({a.late}/{a.total}, worst {num(a.worstDays)}d over)</small>
                </span>
              </li>
            ))}
            {data.lateAgencies.length === 0 && <li className="empty">No late reporting found in this window.</li>}
          </ol>
        </section>

        <section>
          <h2>Biggest spenders</h2>
          <p className="note">Total value of new contracts published.</p>
          <ol className="rank">
            {data.topAgencies.map((a) => (
              <li key={a.name}>
                <span className="name">{a.name}</span>
                <span className="bar" style={{ ["--w" as any]: `${pct(a.value, data.topAgencies[0].value)}%` }} />
                <span className="val">{money(a.value)} <small>({num(a.count)})</small></span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="split">
        <section>
          <h2>Top suppliers</h2>
          <p className="note">Grouped by ABN where one is recorded.</p>
          <ol className="rank">
            {data.topSuppliers.map((s) => (
              <li key={s.abn ?? s.name}>
                <span className="name">
                  {s.name} {s.abn && <small>ABN {s.abn}</small>}
                </span>
                <span className="bar" style={{ ["--w" as any]: `${pct(s.value, data.topSuppliers[0].value)}%` }} />
                <span className="val">{money(s.value)} <small>({num(s.count)})</small></span>
                {isFms(s.name) && (
                  <details className="more">
                    <summary>Show more</summary>
                    {fmsNote}
                    <ul>
                      {data.contracts
                        .filter((c) => c.supplier === s.name)
                        .sort((a, b) => b.value - a.value)
                        .map((c) => (
                          <li key={c.id}>
                            <a href={apiLink(c.id)} target="_blank" rel="noreferrer">{c.id}</a>{" "}
                            {c.description}, {moneyFull(c.value)}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Why competition was skipped</h2>
          <p className="note">Reasons agencies gave for limited tenders, by contract value.</p>
          <ol className="rank">
            {data.limitedReasons.map((r) => (
              <li key={r.name}>
                <span className="name">{r.name}</span>
                <span className="bar" style={{ ["--w" as any]: `${pct(r.value, data.limitedReasons[0].value)}%` }} />
                <span className="val">{money(r.value)} <small>({num(r.count)})</small></span>
              </li>
            ))}
            {data.limitedReasons.length === 0 && <li className="empty">No limited tenders in this window.</li>}
          </ol>
        </section>
      </div>

      <section>
        <h2>Largest contracts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Agency</th>
                <th scope="col">Supplier</th>
                <th scope="col">Category</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.biggest.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={apiLink(c.id)} target="_blank" rel="noreferrer">{c.id}</a>
                    <div className="desc">{c.description}</div>
                    {isFms(c.supplier) && (
                      <details className="more">
                        <summary>Show more</summary>
                        {fmsNote}
                        <ul>
                          <li>Contract period: {day(c.start)} to {day(c.end)}</li>
                          <li>Published: {day(c.published)}</li>
                          {c.limitedReason && <li>Reason given for limited tender: {c.limitedReason}</li>}
                          {c.unspsc && <li>Classification: {c.category.name} (UNSPSC {c.unspsc})</li>}
                          {c.supplierCountry && <li>Supplier address: {c.supplierCountry}</li>}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>{c.agency}</td>
                  <td>{c.supplier}</td>
                  <td>{c.category.name}</td>
                  <td>
                    <span className={c.method === "limited" ? "tag limited" : "tag"}>{c.method}</span>
                    {c.lateDays !== null && c.lateDays > 0 && <span className="tag late">{num(c.lateDays)}d late</span>}
                  </td>
                  <td className="num">{moneyFull(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
