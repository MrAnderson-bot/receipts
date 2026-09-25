// They Vote For You (OpenAustralia Foundation): every MP's and senator's voting
// record, built from Hansard divisions. Not a government source, but open and
// built from the parliament's own record. Licence CC BY-SA; attribute as
// "They Vote For You, OpenAustralia Foundation". The API needs a free key:
// https://theyvoteforyou.org.au/help/data. Set TVFY_API_KEY in the environment.
import { unstable_cache } from "next/cache";
import { USER_AGENT } from "../xlsx";

const BASE = "https://theyvoteforyou.org.au/api/v1";
export const TVFY_URL = "https://theyvoteforyou.org.au";
export const NO_KEY = "needs an API key: register at https://theyvoteforyou.org.au/users/sign_up and set TVFY_API_KEY";
// Either name works; the older one is what .env.local has carried since before this module existed.
const apiKey = () => (process.env.TVFY_API_KEY ?? process.env.THEY_VOTE_FOR_YOU_API_KEY ?? "").trim();

export type Member = {
  id: number;
  name: string;
  party: string;
  electorate: string;
  house: "representatives" | "senate";
  votesAttended: number | null;
  votesPossible: number | null;
  rebellions: number | null; // divisions where the member voted against most of their party
  url: string;
};

export type Parliament = {
  members: Member[];
  parties: { name: string; count: number; attendance: number | null; rebellionRate: number | null }[]; // largest first
  readAt: string;
  sourceUrl: string;
};

async function getJson(path: string, key: string): Promise<any> {
  // Not cached per request: the people list is large and there are hundreds of member pages. The parsed result
  // is cached once, below.
  const res = await fetch(`${BASE}/${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`, {
    headers: { "User-Agent": USER_AGENT }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`theyvoteforyou.org.au returned ${res.status} for ${path}`);
  return res.json();
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Presiding officers are listed under their office rather than their party.
const PARTY: Record<string, string> = {
  SPK: "Speaker", PRES: "President of the Senate", DPRES: "Deputy President of the Senate", CWM: "Chair of Committees",
};

async function load(): Promise<Parliament> {
  const key = apiKey();
  if (!key) throw new Error(NO_KEY);

  // The list gives who sits now; each person's own record gives the counts.
  const people: any[] = await getJson("people.json", key);
  const members: Member[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < people.length) {
      const p = people[next++];
      const m = p.latest_member ?? {};
      let detail: any = {};
      try { detail = await getJson(`people/${p.id}.json`, key); } catch { detail = {}; }
      members.push({
        id: p.id,
        name: [m.name?.first, m.name?.last].filter(Boolean).join(" ") || "Unknown",
        party: PARTY[m.party] ?? m.party ?? "Unknown",
        electorate: m.electorate ?? "",
        house: m.house === "senate" ? "senate" : "representatives",
        votesAttended: num(detail.votes_attended),
        votesPossible: num(detail.votes_possible),
        rebellions: num(detail.rebellions),
        url: `${TVFY_URL}/people/${m.house === "senate" ? "senate" : "representatives"}/${encodeURIComponent(String(m.electorate ?? "").toLowerCase())}/${encodeURIComponent(`${m.name?.first ?? ""}_${m.name?.last ?? ""}`.toLowerCase())}`,
      });
    }
  }));
  if (members.length === 0) throw new Error("They Vote For You returned no members");

  const byParty = new Map<string, Member[]>();
  for (const m of members) byParty.set(m.party, [...(byParty.get(m.party) ?? []), m]);
  const parties = [...byParty].map(([name, ms]) => {
    const attended = ms.reduce((s, m) => s + (m.votesAttended ?? 0), 0);
    const possible = ms.reduce((s, m) => s + (m.votesPossible ?? 0), 0);
    const rebellions = ms.reduce((s, m) => s + (m.rebellions ?? 0), 0);
    return {
      name, count: ms.length,
      attendance: possible ? (attended / possible) * 100 : null,
      rebellionRate: attended ? (rebellions / attended) * 100 : null,
    };
  }).sort((a, b) => b.count - a.count);

  return { members: members.sort((a, b) => a.party.localeCompare(b.party) || a.name.localeCompare(b.name)), parties, readAt: new Date().toISOString(), sourceUrl: TVFY_URL };
}

// Divisions happen on sitting days only, so once a day is enough; the whole read takes about two minutes.
const cached = unstable_cache(load, ["they-vote-for-you"], { revalidate: 86_400 });

export async function tryGetParliament(): Promise<{ data: Parliament | null; error: string | null }> {
  try {
    return { data: await cached(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
