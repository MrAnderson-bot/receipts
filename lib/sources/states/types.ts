// One shape for every state and territory, so a new portal is one new module.
import { segmentOf } from "../../unspsc";

export type StateContract = {
  id: string;
  agency: string;
  supplier: string;
  supplierAbn: string | null;
  description: string;
  method: string; // as the state words it
  category: string | null; // UNSPSC segment name where the state publishes a code
  value: number;
  awarded: string; // ISO date
};

export type Bucket = { name: string; value: number; count: number };

export type StateSummary = {
  code: "NSW" | "VIC" | "QLD" | "WA" | "NT" | "TAS" | "ACT";
  name: string;
  noun: "contracts" | "invoices"; // the ACT publishes payments, not contract awards
  period: string; // what the figures cover, in words
  coverage: string; // what is and isn't in the data
  sourceName: string;
  sourceUrl: string;
  licence: string;
  count: number;
  totalValue: number;
  openValue: number; // value awarded through an open or public process
  topAgencies: Bucket[];
  topSuppliers: Bucket[];
  methods: Bucket[];
  categories: Bucket[];
  biggest: StateContract[];
  filesRead: number;
  filesSkipped: { name: string; reason: string }[];
};

export const categoryOf = (unspsc: string | null | undefined) => {
  const seg = segmentOf(unspsc);
  return seg.code === "--" ? null : seg.name;
};

function rank(contracts: StateContract[], key: (c: StateContract) => string | null, n: number): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const c of contracts) {
    const name = key(c);
    if (!name) continue;
    const b = map.get(name) ?? { name, value: 0, count: 0 };
    b.value += c.value; b.count++; map.set(name, b);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);
}

// Agencies type the method by hand: OPEN, Open and open are the same thing.
function tidyMethod(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t || /^n\/?a$/.test(t)) return "Not stated";
  if (t === "select") return "Selective";
  return t[0].toUpperCase() + t.slice(1);
}

export function summarise(
  contracts: StateContract[],
  meta: Omit<StateSummary, "count" | "totalValue" | "openValue" | "topAgencies" | "topSuppliers" | "methods" | "categories" | "biggest">,
): StateSummary {
  return {
    ...meta,
    count: contracts.length,
    totalValue: contracts.reduce((sum, c) => sum + c.value, 0),
    openValue: contracts.filter((c) => /open|public/i.test(c.method)).reduce((sum, c) => sum + c.value, 0),
    topAgencies: rank(contracts, (c) => c.agency, 8),
    // Panels and unnamed suppliers are groups, not a supplier.
    topSuppliers: rank(contracts, (c) => (/^(several suppliers|not published)/i.test(c.supplier) ? null : c.supplier), 8),
    methods: rank(contracts, (c) => tidyMethod(c.method), 8),
    categories: rank(contracts, (c) => c.category, 10),
    biggest: [...contracts].sort((a, b) => b.value - a.value).slice(0, 12),
  };
}
