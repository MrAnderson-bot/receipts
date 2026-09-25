import type { Metadata } from "next";
import { tryGetParliament, TVFY_URL, NO_KEY } from "@/lib/sources/tvfy";
import { num } from "@/lib/format";

export const revalidate = 86_400;
export const metadata: Metadata = { title: "Parliament" };

const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)}%`);
const attendance = (a: number | null, p: number | null) => (a !== null && p ? (a / p) * 100 : null);
const rebellionRate = (r: number | null, a: number | null) => (r !== null && a ? (r / a) * 100 : null);
const HOUSE = { representatives: "House of Representatives", senate: "Senate" };

export default async function Page() {
  const { data, error } = await tryGetParliament();

  if (!data) {
    const noKey = error === NO_KEY;
    return (
      <>
        <section className="hero compact">
          <h1>Parliament</h1>
          <p>
            How every MP and senator votes, from They Vote For You, which the OpenAustralia Foundation builds from
            the parliament’s own Hansard record of divisions.
          </p>
        </section>
        <section className="error">
          <h2>{noKey ? "Not connected yet" : "They Vote For You didn’t answer."}</h2>
          <p>
            {noKey
              ? "This feed needs a free API key from They Vote For You. Register on their site, then set TVFY_API_KEY where the site is built."
              : error}
          </p>
          <p className="more"><a href={`${TVFY_URL}/help/data`} target="_blank" rel="noreferrer">About the They Vote For You API</a></p>
        </section>
      </>
    );
  }

  const houses = ["representatives", "senate"] as const;

  return (
    <>
      <section className="hero compact">
        <h1>Parliament</h1>
        <p>
          How every MP and senator votes, from They Vote For You, which the OpenAustralia Foundation builds from
          the parliament’s own Hansard record of divisions. Attendance is divisions voted in as a share of divisions
          held while the member sat. A rebellion is a vote against the way most of the member’s party voted.
        </p>
      </section>

      <section>
        <h2>By party</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Party</th>
                <th scope="col" className="num">Members</th>
                <th scope="col" className="num">Attendance</th>
                <th scope="col" className="num">Rebellion rate</th>
              </tr>
            </thead>
            <tbody>
              {data.parties.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="num">{num(p.count)}</td>
                  <td className="num">{pct(p.attendance)}</td>
                  <td className="num">{pct(p.rebellionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {houses.map((house) => (
        <section key={house}>
          <h2>{HOUSE[house]}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Party</th>
                  <th scope="col">{house === "senate" ? "State" : "Electorate"}</th>
                  <th scope="col" className="num">Divisions attended</th>
                  <th scope="col" className="num">Attendance</th>
                  <th scope="col" className="num">Rebellions</th>
                </tr>
              </thead>
              <tbody>
                {data.members.filter((m) => m.house === house).map((m) => (
                  <tr key={m.id}>
                    <td><a href={m.url} target="_blank" rel="noreferrer">{m.name}</a></td>
                    <td>{m.party}</td>
                    <td>{m.electorate}</td>
                    <td className="num">{m.votesAttended !== null && m.votesPossible !== null ? `${num(m.votesAttended)} of ${num(m.votesPossible)}` : "–"}</td>
                    <td className="num">{pct(attendance(m.votesAttended, m.votesPossible))}</td>
                    <td className="num">{m.rebellions !== null ? `${num(m.rebellions)} (${pct(rebellionRate(m.rebellions, m.votesAttended))})` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <footer>
        Source: <a href={TVFY_URL} target="_blank" rel="noreferrer">They Vote For You</a>, OpenAustralia Foundation, licensed CC BY-SA. Not a
        government source: it is built from Hansard, the parliament’s official record, and every member’s page there
        links each vote back to it. Read {new Date(data.readAt).toLocaleDateString("en-AU")}.
      </footer>
    </>
  );
}
