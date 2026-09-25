// Pulls contract notices from the official AusTender OCDS API and turns them
// into dashboard figures. Data: AusTender, CC BY 3.0 AU.
// API docs: https://github.com/austender/austender-ocds-api
import { segmentOf, isService } from "../unspsc";
import { USER_AGENT } from "../xlsx";

const BASE = "https://api.tenders.gov.au/ocds";
const DAY = 86_400_000;
export const DEADLINE_DAYS = 42; // contracts must be published within 42 days

export type Contract = {
  id: string;
  awardId: string | null; // carries the id of the notice's web page (see noticePageId)
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

// An amendment notice republishes a contract with its new total value; the id is the original's plus -A1, -A2 ...
export type Amendment = {
  id: string; baseId: string; awardId: string | null; agency: string; supplier: string; value: number; description: string;
  published: string; end: string | null;
};

export type Summary = {
  from: Date;
  to: Date;
  contracts: Contract[];
  amendments: number;
  amended: Amendment[]; // every amendment notice in the window, newest first
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
    const award = (rel.awards ?? []).find((a: any) => a.id === c.awardID) ?? rel.awards?.[0];
    return {
      id: String(c.id ?? rel.ocid),
      awardId: award?.id ? String(award.id) : null,
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

// --- the notice web page --------------------------------------------------
// The API leaves out fields the public page shows: execution date, extension
// options, the "Australian business engaged" flag, confidentiality and more.
// The page id is the hex tail of the award id: CN4277004-b918aacd84a6... ->
// tenders.gov.au/Cn/Show/b918aacd-84a6-4b04-a2b8-69c6ca504c85.

export const noticePageId = (awardId: string | null): string | null => {
  const hex = awardId?.split("-").pop() ?? "";
  return /^[0-9a-f]{32}$/i.test(hex) ? hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") : null;
};
export const noticeUrl = (pageId: string) => `https://www.tenders.gov.au/Cn/Show/${pageId}`;

// Every labelled field on the page, as published. Dates are ISO; money is a number; the rest is text.
export type Notice = {
  cnId: string;
  agency: string | null;
  publishDate: string | null;
  category: string | null;
  executionDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  extensionOptions: number | null;
  maxEndDate: string | null;
  value: number | null;
  description: string | null;
  procurementMethod: string | null;
  limitedTenderExemption: string | null;
  atmId: string | null;
  sonId: string | null; // standing offer notice, when bought off a panel
  australianBusiness: string | null; // "Yes" | "No" as written
  smeEngaged: string | null; // only on some notices
  smeReason: string | null; // why an SME wasn't engaged
  nzBusiness: string | null;
  suppliersInvited: number | null;
  confidentialContract: string | null;
  confidentialContractReason: string | null;
  confidentialOutputs: string | null;
  confidentialOutputsReason: string | null;
  consultancy: string | null;
  agencyReferenceId: string | null;
  supplierName: string | null;
  supplierTown: string | null;
  supplierPostcode: string | null;
  supplierState: string | null;
  supplierCountry: string | null;
  supplierAbn: string | null; // "Exempt" when the supplier has none
};

// Labels as they appear on the page, in the order they appear. Contact details
// (agency officer name, phone, email) are deliberately not read.
const LABELS: [keyof Notice, string][] = [
  ["cnId", "CN ID"], ["agency", "Agency"], ["publishDate", "Publish Date"], ["category", "Category"],
  ["executionDate", "Execution Date"], ["periodStart", "Contract Period"], ["extensionOptions", "Extension Options"],
  ["maxEndDate", "Max End Date"], ["value", "Contract Value (AUD)"], ["description", "Description"],
  ["procurementMethod", "Procurement Method"], ["limitedTenderExemption", "Limited Tender Exemption"], ["atmId", "ATM ID"],
  ["sonId", "SON ID"],
  ["australianBusiness", "Was an Australian business Engaged?"], ["smeEngaged", "Was an SME engaged?"],
  ["smeReason", "Why wasn’t an SME engaged?"], ["smeReason", "Why wasn't an SME engaged?"], ["nzBusiness", "Was a New Zealand business engaged?"],
  ["suppliersInvited", "Suppliers Invited"], ["confidentialContract", "Confidentiality - Contract"],
  ["confidentialContractReason", "Confidentiality Reason(s) - Contract"], ["confidentialOutputs", "Confidentiality - Outputs"],
  ["confidentialOutputsReason", "Confidentiality Reason(s) - Outputs"], ["consultancy", "Consultancy"],
  ["agencyReferenceId", "Agency Reference ID"], ["supplierName", "Name"], ["supplierTown", "Town/City"],
  ["supplierPostcode", "Postcode"], ["supplierState", "State/Territory"], ["supplierCountry", "Country"], ["supplierAbn", "ABN"],
];

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
// "15-Sep-2026" -> "2026-09-15"
const dmy = (s: string | null): string | null => {
  const m = s?.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  return m && MONTHS[m[2].toLowerCase()] ? `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}` : null;
};
const int = (s: string | null) => (s && /^\d+$/.test(s.trim()) ? Number(s) : null);

export function parseNotice(html: string): Notice {
  const lines = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^CN ID:?$/i.test(l));
  if (start < 0) throw new Error("Not a contract notice page");

  const raw: Partial<Record<keyof Notice, string>> = {};
  let current: keyof Notice | null = null;
  let stop = false;
  for (const line of lines.slice(start)) {
    // The supplier block ends where the agency contact block begins.
    if (current === "supplierAbn" && /^Agency Details$/i.test(line)) stop = true;
    if (stop) break;
    const hit = LABELS.find(([, label]) => line.toLowerCase().startsWith(label.toLowerCase() + ":") || line.toLowerCase() === label.toLowerCase());
    if (hit) {
      current = hit[0];
      const rest = line.slice(hit[1].length).replace(/^:\s*/, "").trim();
      raw[current] = rest;
    } else if (current) {
      raw[current] = raw[current] ? `${raw[current]} ${line}` : line;
    }
  }

  const period = raw.periodStart?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})\s*to\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  const money = raw.value?.replace(/[^0-9.]/g, "");
  return {
    cnId: raw.cnId ?? "",
    agency: raw.agency ?? null,
    publishDate: dmy(raw.publishDate ?? null),
    category: raw.category ?? null,
    executionDate: dmy(raw.executionDate ?? null),
    periodStart: period ? dmy(period[1]) : null,
    periodEnd: period ? dmy(period[2]) : null,
    extensionOptions: int(raw.extensionOptions ?? null),
    maxEndDate: dmy(raw.maxEndDate ?? null),
    value: money ? Number(money) : null,
    description: raw.description ?? null,
    procurementMethod: raw.procurementMethod ?? null,
    limitedTenderExemption: raw.limitedTenderExemption ?? null,
    atmId: raw.atmId ?? null,
    sonId: raw.sonId ?? null,
    australianBusiness: raw.australianBusiness ?? null,
    smeEngaged: raw.smeEngaged ?? null,
    smeReason: raw.smeReason ?? null,
    nzBusiness: raw.nzBusiness ?? null,
    suppliersInvited: int(raw.suppliersInvited ?? null),
    confidentialContract: raw.confidentialContract ?? null,
    confidentialContractReason: raw.confidentialContractReason ?? null,
    confidentialOutputs: raw.confidentialOutputs ?? null,
    confidentialOutputsReason: raw.confidentialOutputsReason ?? null,
    consultancy: raw.consultancy ?? null,
    agencyReferenceId: raw.agencyReferenceId ?? null,
    supplierName: raw.supplierName ?? null,
    supplierTown: raw.supplierTown ?? null,
    supplierPostcode: raw.supplierPostcode ?? null,
    supplierState: raw.supplierState ?? null,
    supplierCountry: raw.supplierCountry ?? null,
    supplierAbn: raw.supplierAbn ?? null,
  };
}

// Plain Node HTTPS, not Next's fetch: these pages are read during the build,
// where an uncached fetch is refused and a cached one would keep 100 KB of HTML
// per notice. A redirect to /System/NotFound means the id is unknown.
function rawGet(url: string, hops = 0): Promise<{ status: number; body: string }> {
  const https = (process as any).getBuiltinModule?.("node:https");
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": USER_AGENT } }, (res: any) => {
      const to = res.headers.location as string | undefined;
      if (res.statusCode >= 300 && res.statusCode < 400 && to) {
        res.resume();
        if (/NotFound/i.test(to)) return reject(new Error("AusTender has no page for this notice"));
        if (hops >= 3) return reject(new Error("Too many redirects"));
        return resolve(rawGet(new URL(to, url).toString(), hops + 1));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

export async function fetchNotice(pageId: string): Promise<Notice> {
  const { status, body } = await rawGet(noticeUrl(pageId));
  if (status !== 200) throw new Error(`AusTender returned ${status} for notice ${pageId}`);
  return parseNotice(body);
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
  const amended: Amendment[] = [];
  for (const rel of releases) {
    for (const c of toContracts(rel)) {
      if (c.amendment) {
        amendments++;
        amended.push({
          id: c.id, baseId: c.id.replace(/-A\d+$/i, ""), awardId: c.awardId, agency: c.agency, supplier: c.supplier,
          value: c.value, description: c.description, published: c.published, end: c.end,
        });
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
    from, to, contracts, amendments, amended: amended.sort((a, b) => b.published.localeCompare(a.published)),
    totalValue, limitedValue, overseasValue, servicesValue, lateCount,
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
