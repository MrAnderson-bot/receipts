// State and territory grant payments. One shape for every jurisdiction, so a
// new portal is one new module, the same way state contracts work.

export type StateGrantCode = "QLD" | "NSW" | "VIC" | "WA" | "SA" | "TAS" | "ACT" | "NT";

// One payment line, reduced to what the page shows. The full row as published
// is kept separately (StateGrantRow) for the database.
export type StateGrant = {
  agency: string; // full name where the code is known, else as published
  agencyCode: string;
  program: string;
  subProgram: string;
  purpose: string;
  recipient: string; // legal entity name as published
  recipientAbn: string | null;
  pooled: boolean; // no ABN and a label such as "Multiple" or "Various - Confidential": individuals pooled by program for privacy
  recipientType: string;
  category: string;
  assistance: string; // Grant, Frontline service procurement, Concession, Loan, Direct government investment
  fundingSource: string; // Queensland Government, Australian Government, Combined, Other
  value: number; // paid in the financial year
  agreementTotal: number | null; // total under the agreement to date, where given
  start: string | null; // ISO date
  end: string | null;
  deliveryLga: string;
};

// One stored line: the reduced grant plus every column of the published file, as text, keyed by
// the published heading. `id` is stable for the source (a row number where a whole file is republished,
// a content key where a list rolls forward).
// `programId` is the source's own id for the grant program the line belongs to, where it has one (NSW's
// grant node id), so a program can be re-read and its stale lines dropped without touching the rest.
export type StateGrantRow = { state: StateGrantCode; year: string; id: string; programId: string; sourceUrl: string; value: number; grant: StateGrant; fields: Record<string, string> };

// What a full load returns: the page summary, every row for the database, and whether those rows are
// the whole of their years (so a stored row missing from the load is gone from the source too) or a
// rolling window to accumulate.
export type StateGrantsLoad = { summary: StateGrantSummary; rows: StateGrantRow[]; replaceYears: boolean };

export type Bucket = { name: string; value: number; count: number };

export type StateGrantSummary = {
  code: StateGrantCode;
  name: string;
  year: string; // FY2024-25, or a rolling window in words
  subject: string; // the hero sentence after the amount: "paid out by the Queensland government in grants and program funding"
  period: string; // in words
  coverage: string; // what is and isn't in the data
  sourceName: string;
  sourceUrl: string;
  fileUrl: string;
  licence: string;
  count: number;
  totalValue: number;
  grantValue: number; // assistance type "Grant" only
  frontlineValue: number; // "Frontline service procurement": services bought from providers, published alongside grants
  pooledValue: number; // paid to recipients the publisher pools under a label instead of a name (individuals, for privacy)
  commonwealthValue: number; // funding source wholly Australian Government: passed-through federal money
  previous: { year: string; count: number; totalValue: number } | null;
  topAgencies: Bucket[];
  topRecipients: Bucket[];
  topPrograms: Bucket[];
  categories: Bucket[];
  recipientTypes: Bucket[];
  assistanceTypes: Bucket[];
  fundingSources: Bucket[];
  biggest: StateGrant[];
  unknownAgencyCodes: string[]; // codes the map in the loader doesn't know, shown as published
};

export function rank(grants: StateGrant[], key: (g: StateGrant) => string | null, n: number): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const g of grants) {
    const name = key(g);
    if (!name) continue;
    const b = map.get(name) ?? { name, value: 0, count: 0 };
    b.value += g.value; b.count++; map.set(name, b);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);
}

const sum = (grants: StateGrant[], test: (g: StateGrant) => boolean) => grants.filter(test).reduce((s, g) => s + g.value, 0);

// Recipients are grouped by ABN where one is given, so a body's trading names add up.
const recipientKey = (g: StateGrant) => (g.pooled ? null : g.recipientAbn ?? g.recipient);

export function summarise(
  grants: StateGrant[],
  meta: Pick<StateGrantSummary, "code" | "name" | "year" | "subject" | "period" | "coverage" | "sourceName" | "sourceUrl" | "fileUrl" | "licence" | "previous" | "unknownAgencyCodes">,
): StateGrantSummary {
  // Rank by ABN, then show the most common name for that ABN.
  const names = new Map<string, Map<string, number>>();
  for (const g of grants) {
    const k = recipientKey(g);
    if (!k) continue;
    const m = names.get(k) ?? new Map<string, number>();
    m.set(g.recipient, (m.get(g.recipient) ?? 0) + 1); names.set(k, m);
  }
  const nameOf = (k: string) => [...(names.get(k) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? k;

  return {
    ...meta,
    count: grants.length,
    totalValue: grants.reduce((s, g) => s + g.value, 0),
    grantValue: sum(grants, (g) => /^grant$/i.test(g.assistance)),
    frontlineValue: sum(grants, (g) => /frontline/i.test(g.assistance)),
    pooledValue: sum(grants, (g) => g.pooled),
    commonwealthValue: sum(grants, (g) => /^australian government$/i.test(g.fundingSource)),
    topAgencies: rank(grants, (g) => g.agency, 10),
    topRecipients: rank(grants, recipientKey, 10).map((b) => ({ ...b, name: nameOf(b.name) })),
    topPrograms: rank(grants, (g) => g.program, 10),
    categories: rank(grants, (g) => g.category || "Not stated", 12),
    recipientTypes: rank(grants, (g) => g.recipientType || "Not stated", 8),
    assistanceTypes: rank(grants, (g) => g.assistance || "Not stated", 6),
    fundingSources: rank(grants, (g) => g.fundingSource || "Not stated", 4),
    biggest: [...grants].sort((a, b) => b.value - a.value).slice(0, 15),
  };
}
