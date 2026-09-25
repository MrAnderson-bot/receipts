import type { Metadata } from "next";
import Link from "next/link";
import { getIndicators } from "@/lib/economy";
import { tryGetBudget } from "@/lib/sources/budget";
import { tryGetSummary } from "@/lib/sources/austender";
import { tryGetHomelessness } from "@/lib/sources/homelessness";
import { tryGetCrime } from "@/lib/sources/crime";
import { scorecard, SCORECARD_INPUTS, SCORECARD_EXTRA_IDS, ACCORD } from "@/lib/scorecard";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Scorecard" };

const STATUS = { met: "Met", missed: "Missed", "no-data": "No data" };
const TAG = { met: "clear", missed: "triggered", "no-data": "watch" }; // reuse the recession watch's tag styles
const BASIS = { published: "Government target", yardstick: "Our yardstick" };
const outOf = (n: number | null) => (n === null ? "–" : `${n} / 100`);
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export default async function Page() {
  const [results, budget, contracts, homelessness, crime] = await Promise.all([
    getIndicators(SCORECARD_INPUTS), tryGetBudget(), tryGetSummary(90), tryGetHomelessness(), tryGetCrime(),
  ]);
  // The Response group reads two yearly series that come from the crime and homelessness loaders.
  const extra = [...(homelessness.shs.data?.series ?? []), ...(crime.offenders.data?.series ?? [])].filter((s) => SCORECARD_EXTRA_IDS.includes(s.id));
  const card = scorecard(results, budget.data, contracts.data, extra);
  const scoredPillars = card.pillars.filter((p) => p.score !== null);
  const weakest = [...scoredPillars].sort((a, b) => a.score! - b.score!);
  const lowest = weakest.filter((p) => p.score === weakest[0]?.score);
  const highest = weakest.filter((p) => p.score === weakest[weakest.length - 1]?.score);
  const missedTargets = card.pillars.flatMap((p) => p.kpis).filter((k) => k.basis === "published" && k.status === "missed");

  return (
    <>
      <section className="hero compact">
        <h1>Government scorecard</h1>
        <p>
          {card.total} indicators of how the country is going on affordability, housing, jobs, the budget,
          investment, procurement and whether planned spending follows the pressure at home, each read from an
          official figure against a fixed, printed rule.
          Where the government has set a target, the rule is that target. Where it hasn’t, the rule is
          a yardstick of ours, marked as such, and you can disagree with it.
        </p>
      </section>

      <section id="summary">
        <h2>The score</h2>
        <div className="figures">
          <div>
            <strong>{outOf(card.score)}</strong>
            <span>{card.met} of {card.scored} readable rules met, every rule counting the same</span>
          </div>
          <div>
            <strong>{outOf(card.targetsScore)}</strong>
            <span>on the government’s own published targets alone</span>
          </div>
          <div>
            <strong>{card.total - card.scored}</strong>
            <span>not read this time because a source didn’t answer</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Group</th><th>Asks</th><th>Met</th><th className="num">Score</th></tr>
            </thead>
            <tbody>
              {card.pillars.map((p) => (
                <tr key={p.id}>
                  <td><a href={`#${p.id}`}>{p.name}</a></td>
                  <td><div className="desc">{p.question}</div></td>
                  <td>{p.met} of {p.scored}{p.scored < p.kpis.length ? <div className="desc">{p.kpis.length - p.scored} not read</div> : null}</td>
                  <td className="num">{outOf(p.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{card.method}</p>
      </section>

      <section id="improve">
        <h2>What would lift the score</h2>
        {scoredPillars.length > 0 && (
          <p>
            {lowest.length === scoredPillars.length
              ? `Every group scores ${lowest[0].score} out of 100.`
              : `The weakest ${lowest.length === 1 ? "group is" : "groups are"} ${list(lowest.map((p) => `${p.name} (${p.score})`))}; the strongest ${highest.length === 1 ? "is" : "are"} ${list(highest.map((p) => `${p.name} (${p.score})`))}.`}
            {missedTargets.length > 0
              ? ` Of the government’s own targets, ${list(missedTargets.map((k) => k.name.toLowerCase()))} ${missedTargets.length === 1 ? "is" : "are"} missed.`
              : " Every published government target that could be read is met."}
            {" "}Each missed rule below says what has to change for it to be met. Some pull against each other, so this is
            the list of gaps, not a plan.
          </p>
        )}
        {weakest.filter((p) => p.kpis.some((k) => k.status === "missed")).map((p) => (
          <div key={p.id}>
            <h3>{p.name}: {outOf(p.score)}</h3>
            <ul>
              {p.kpis.filter((k) => k.status === "missed").map((k) => (
                <li key={k.id}>
                  <Link href={k.href}>{k.name}</Link>: {k.toMeet ?? "see the rule below"}.
                  {k.basis === "published" && <span className="desc"> Government target.</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {card.scored > 0 && card.met === card.scored && <p>Every readable rule is met.</p>}
      </section>

      {card.pillars.map((p) => (
        <section key={p.id} id={p.id}>
          <h2>{p.name}</h2>
          <p className="note">{p.question} {p.met} of {p.scored} met, score {outOf(p.score)}.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Indicator</th><th>Latest reading</th><th>Status</th><th>Rule</th></tr>
              </thead>
              <tbody>
                {p.kpis.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <Link href={k.href}>{k.name}</Link>
                      <div className="desc">{BASIS[k.basis]}</div>
                    </td>
                    <td>{k.reading}{k.asOf && <div className="desc">{k.asOf}</div>}</td>
                    <td><span className={`tag ${TAG[k.status]}`}>{STATUS[k.status]}</span></td>
                    <td><div className="desc">{k.rule}{k.toMeet && ` To meet it: ${k.toMeet}.`}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section id="method">
        <h2>How to read it</h2>
        <p>
          The score is the share of rules met among those that could be read, rounded to a whole number, with
          every rule counting the same. That is the whole method: there is no weighting between groups and no
          model behind it, so the score can be checked by counting the tables above. A group’s score is the same
          calculation over its own rules. The second figure applies the calculation only to the rules that are the
          government’s own published targets.
        </p>
        <p>
          Every indicator links to the chart or table it is read from, and every chart names its publisher
          and links to the record. The Housing Accord rule spreads {(ACCORD.homes / 1e6).toFixed(1)} million
          homes evenly over five years from July 2024; the government has not published a yearly profile, so
          an even one is used and said so. Budget rules compare the last two years with a final outcome and
          ignore estimates, because estimates change with every Budget. Procurement rules read the last 90
          days of AusTender notices and use fixed thresholds until a year of stored history lets them compare
          with the same window a year earlier.
        </p>
        <p>
          A checklist with a count, not a verdict: a missed indicator is a fact about the country, not a failure
          by anyone in particular, and some yardsticks pull against each other by design (more public investment
          and lower debt, for instance). The point is that the rules are fixed and printed, so the same test is
          applied every day. The reasoning behind each rule and what is still missing is in the repository, in{" "}
          <code>docs/kpi-scorecard.md</code>.
        </p>
        {card.missing.length > 0 && (
          <p className="note">Not read this time because the source didn’t answer: {card.missing.join("; ")}.</p>
        )}
        {budget.error && <p className="note">Budget tables: {budget.error}</p>}
        {contracts.error && <p className="note">AusTender: {contracts.error}</p>}
      </section>
    </>
  );
}
