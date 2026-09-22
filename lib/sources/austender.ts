// Pulls contract notices from the official AusTender OCDS API and turns them
// into dashboard figures. Data: AusTender, CC BY 3.0 AU.
// API docs: https://github.com/austender/austender-ocds-api
import { segmentOf, isService } from "../unspsc";

const BASE = "https://api.tenders.gov.au/ocds";
const DAY = 86_400_000;
export const DEADLINE_DAYS = 42; // contracts must be published within 42 days

export type Contract = {
  id: string;
  agency: string;
  supplier: string;
  supplierAbn: string | null;
  supplierCountry: string | null;
  value: number;
  description: string;
  method: string; // open | selective | limited
  limitedReason: string | null; // why open competition was skipped, as stated by the agency
  category: { code: string; name: string }; // UNSPSC segment
  unspsc: string | null; // full classification code
  start: string | null; // contract period start
  end: string | null;
  published: string;
  // Days past the 42-day deadline, measured from the contract start date.
  // The API's dateSigned field just repeats the publish timestamp, so the
  // start date is the only usable reference. null if there is no start date.
  lateDays: number | null;
};

type Bucket = { name: string; value: number; count: number };

export type Category = {
  code: string;
  name: string;
  service: boolean;
  value: number;
  count: number;
  limitedValue: number;
  topAgency: Bucket | null;
  topSupplier: Bucket | null;
  biggest: Contract | null;
};

export type Summary = {
  from: Date;
  to: Date;
  contracts: Contract[];
  amendments: number;
  totalValue: number;
  limitedValue: number;
  overseasValue: number;
  servicesValue: number;
  lateCount: number;
  knownStartCount: number;
  daily: { day: string; value: number; count: number }[];
  topAgencies: Bucket[];
  lateAgencies: { name: string; late: number; total: number; worstDays: number }[];
  topSuppliers: (Bucket & { abn: string | null })[];
  categories: Category[]; // every segment seen, largest first
  limitedReasons: Bucket[];
  biggest: Contract[];
};

const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";

async function fetchWindow(from: Date, to: Date): Promise<any[]> {
  let url: string | null = `${BASE}/findByDates/contractPublished/${iso(from)}/${iso(to)}`;
  const releases: any[] = [];
  let pages = 0;
  while (url && pages < 60) {
    const res: Response = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`AusTender returned ${res.status} for ${url}`);
    const json: any = await res.json();
    releases.push(...(json.releases ?? []));
    url = json.links?.next ?? null;
    pages++;
  }
  return releases;
}

function toContracts(rel: any): (Contract & { amendment: boolean })[] {
  const parties: any[] = rel.parties ?? [];
  const agency =
    parties.find((p) => p.roles?.includes("procuringEntity"))?.name ??
    rel.buyer?.name ??
    "Unknown agency";
  const sup = parties.find((p) => p.roles?.includes("supplier"));
  const abn =
    sup?.additionalIdentifiers?.find((i: any) => /abn/i.test(i.scheme ?? ""))?.id ??
    null;
  const tags: string[] = rel.tag ?? [];

  return (rel.contracts ?? []).map((c: any) => {
    const published = rel.date ?? c.dateSigned;
    const start = c.period?.startDate ?? null;
    let lateDays: number | null = null;
    if (start && published) {
      const days = (Date.parse(published) - Date.parse(start)) / DAY;
      if (Number.isFinite(days)) lateDays = Math.floor(days - DEADLINE_DAYS);
    }
    const unspsc = c.items?.[0]?.classification?.id ?? null;
    return {
      id: String(c.id ?? rel.ocid),
      agency,
      supplier: sup?.name ?? "Unknown supplier",
      supplierAbn: abn,
      supplierCountry: sup?.address?.countryName ?? null,
      value: Number(c.value?.amount ?? 0) || 0,
      description: c.description ?? rel.tender?.description ?? "",
      method: String(rel.tender?.procurementMethod ?? "unknown").toLowerCase(),
      limitedReason: rel.tender?.limitedTenderReason ?? null,
      category: segmentOf(unspsc),
      unspsc: unspsc ? String(unspsc) : null,
      start,
      end: c.period?.endDate ?? null,
      published,
      lateDays,
      amendment:
        /-A\d+$/i.test(String(c.id ?? "")) || tags.includes("contractAmendment"),
    };
  });
}

function rank<T>(map: Map<string, T>, by: (t: T) => number, n: number) {
  return [...map.values()].sort((a, b) => by(b) - by(a)).slice(0, n);
}

function bump(map: Map<string, Bucket>, name: string, value: number) {
  const b = map.get(name) ?? { name, value: 0, count: 0 };
  b.value += value; b.count++; map.set(name, b);
}

export const RANGES = [7, 30, 90] as const;
export const DEFAULT_DAYS = 30;
export const parseDays = (raw: string | undefined, fallback = DEFAULT_DAYS) =>
  RANGES.includes(Number(raw) as any) ? Number(raw) : fallback;

// Pages take the range from the path: /spending (default), /spending/7, /spending/90.
// Exported as a list so the static build can pre-render every range.
export type RangeParams = { days?: string[] };
export const rangeParams = (): RangeParams[] => [{ days: [] }, ...RANGES.map((r) => ({ days: [String(r)] }))];
export const daysFrom = (p: RangeParams) => parseDays(p.days?.[0]);

// For pages: a failed fetch becomes a message, not a crash.
export async function tryGetSummary(days: number): Promise<{ data: Summary | null; error: string | null }> {
  try {
    return { data: await getSummary(days), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getSummary(days: number): Promise<Summary> {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);

  // Query in 7-day windows so no single request gets too large.
  const windows: [Date, Date][] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 7 * DAY) {
    windows.push([new Date(t), new Date(Math.min(t + 7 * DAY, to.getTime()))]);
  }
  const releases = (await Promise.all(windows.map(([a, b]) => fetchWindow(a, b)))).flat();

  const seen = new Map<string, Contract>();
  let amendments = 0;
  for (const rel of releases) {
    for (const c of toContracts(rel)) {
      if (c.amendment) {
        amendments++;
        continue;
      }
      if (!seen.has(c.id)) {
        const { amendment, ...rest } = c;
        seen.set(c.id, rest);
      }
    }
  }
  const contracts = [...seen.values()];

  const dailyMap = new Map<string, { day: string; value: number; count: number }>();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    dailyMap.set(day, { day, value: 0, count: 0 });
  }
  const agencies = new Map<string, Bucket>();
  const late = new Map<string, { name: string; late: number; total: number; worstDays: number }>();
  const suppliers = new Map<string, Bucket & { abn: string | null }>();
  const reasons = new Map<string, Bucket>();
  const cats = new Map<string, Category & { agencies: Map<string, Bucket>; suppliers: Map<string, Bucket> }>();

  let totalValue = 0, limitedValue = 0, overseasValue = 0, servicesValue = 0, lateCount = 0, knownStart = 0;

  for (const c of contracts) {
    totalValue += c.value;
    const limited = c.method === "limited";
    if (limited) {
      limitedValue += c.value;
      bump(reasons, c.limitedReason ?? "No reason given", c.value);
    }
    if (c.supplierCountry && !/^(australia|au)$/i.test(c.supplierCountry.trim())) overseasValue += c.value;

    const d = dailyMap.get(c.published.slice(0, 10));
    if (d) { d.value += c.value; d.count++; }

    bump(agencies, c.agency, c.value);

    const key = c.supplierAbn ?? c.supplier;
    const s = suppliers.get(key) ?? { name: c.supplier, abn: c.supplierAbn, value: 0, count: 0 };
    s.value += c.value; s.count++; suppliers.set(key, s);

    const cat = cats.get(c.category.code) ?? {
      ...c.category, service: isService(c.category.code), value: 0, count: 0, limitedValue: 0,
      topAgency: null, topSupplier: null, biggest: null, agencies: new Map(), suppliers: new Map(),
    };
    cat.value += c.value; cat.count++;
    if (limited) cat.limitedValue += c.value;
    if (!cat.biggest || c.value > cat.biggest.value) cat.biggest = c;
    bump(cat.agencies, c.agency, c.value);
    bump(cat.suppliers, c.supplier, c.value);
    cats.set(c.category.code, cat);
    if (cat.service) servicesValue += c.value;

    if (c.lateDays !== null) {
      knownStart++;
      const l = late.get(c.agency) ?? { name: c.agency, late: 0, total: 0, worstDays: 0 };
      l.total++;
      if (c.lateDays > 0) {
        lateCount++; l.late++;
        l.worstDays = Math.max(l.worstDays, c.lateDays);
      }
      late.set(c.agency, l);
    }
  }

  const categories: Category[] = [...cats.values()]
    .map(({ agencies: a, suppliers: s, ...cat }) => ({
      ...cat,
      topAgency: rank(a, (x) => x.value, 1)[0] ?? null,
      topSupplier: rank(s, (x) => x.value, 1)[0] ?? null,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    from, to, contracts, amendments, totalValue, limitedValue, overseasValue, servicesValue, lateCount,
    knownStartCount: knownStart,
    daily: [...dailyMap.values()],
    topAgencies: rank(agencies, (a) => a.value, 8),
    lateAgencies: [...late.values()]
      .filter((l) => l.late > 0 && l.total >= 5)
      .sort((a, b) => b.late / b.total - a.late / a.total || b.late - a.late)
      .slice(0, 8),
    topSuppliers: rank(suppliers, (s) => s.value, 8),
    categories,
    limitedReasons: rank(reasons, (r) => r.value, 8),
    biggest: [...contracts].sort((a, b) => b.value - a.value).slice(0, 12),
  };
}
