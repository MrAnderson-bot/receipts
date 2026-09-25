// Queensland: the one state with a whole-of-government grants feed. Queensland
// Treasury collects every department's grant and program payments each year
// (the "QGIP expenditure data", once the Queensland Government Investment
// Portal) and publishes one consolidated CSV per financial year on
// data.qld.gov.au (CC BY 4.0). Every line is a payment to a recipient in that
// year: ABN, legal entity, agency, program, purpose, category, recipient type,
// assistance type, funding source, agreement dates and totals.
import { parseCsv, parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { summarise, type StateGrant, type StateGrantRow, type StateGrantSummary, type StateGrantsLoad } from "./types";

const CKAN = "https://www.data.qld.gov.au/api/3/action";
const DATASET = "queensland-government-investment-portal-expenditure-data-consolidated-view";
const DATASET_URL = `https://www.data.qld.gov.au/dataset/${DATASET}`;
const headers = { "User-Agent": USER_AGENT };

// The published headings, in the order the template gives them. A file may carry
// an extra leading "Name" column (the agency file it was consolidated from).
export const QGIP_COLUMNS = [
  "Australian Business Number (ABN)", "Legal entity name", "Service provider name",
  "Legal entity postcode", "Legal entity suburb/locality", "Legal entity LGA",
  "Service delivery postcode", "Service delivery suburb/locality", "Service delivery LGA",
  "Longitude", "Latitude", "Funding agency", "Program title", "Sub-program title", "Statewide", "Purpose",
  "Category1", "Recipient type", "Client group1", "Assistance type1", "Business specific activity",
  "Funding source", "Funding use", "Financial year expenditure", "Funding agreement duration",
  "Funding agreement start", "Funding agreement end", "Total funding under this agreement to date",
  "Total funding under this agreement notes",
] as const;

// Funding agency acronyms. Treasury's data dictionary (September 2024) lists the
// first group; the second group follows the departmental changes of December
// 2024 and is typed from the Administrative Arrangements Order. Codes not here
// are shown as published and listed on the page.
const AGENCIES: Record<string, string> = {
  // to November 2024
  DAF: "Agriculture and Fisheries", DHLGPPW: "Housing, Local Government, Planning and Public Works",
  DCSSDS: "Child Safety, Seniors and Disability Services", DEC: "Energy and Climate",
  DESI: "Environment, Science and Innovation", DESBT: "Employment, Small Business and Training",
  DJAG: "Justice and Attorney-General", DoE: "Education", DoR: "Resources", DPC: "Premier and Cabinet",
  DRDMW: "Regional Development, Manufacturing and Water", DSDI: "State Development and Infrastructure",
  DTATSIPCA: "Treaty, Aboriginal and Torres Strait Islander Partnerships, Communities and the Arts",
  DTS: "Tourism and Sport", DTMR: "Transport and Main Roads", DYJ: "Youth Justice",
  QCS: "Queensland Corrective Services", QFES: "Queensland Fire and Emergency Services", QH: "Queensland Health",
  QPS: "Queensland Police Service", QRA: "Queensland Reconstruction Authority", QT: "Queensland Treasury",
  DES: "Environment and Science", DTIS: "Tourism, Innovation and Sport",
  // from December 2024
  DSROPG: "Sport, Racing and Olympic and Paralympic Games", DFSDSCS: "Families, Seniors, Disability Services and Child Safety",
  DJ: "Justice", DTET: "Trade, Employment and Training",
  DWATSIPM: "Women, Aboriginal and Torres Strait Islander Partnerships and Multiculturalism",
  DHPW: "Housing and Public Works", DETSI: "Environment, Tourism, Science and Innovation", DPI: "Primary Industries",
  DCSODSFB: "Customer Services, Open Data and Small and Family Business",
  DNRMMRRD: "Natural Resources and Mines, Manufacturing, and Regional and Rural Development",
  DSDIP: "State Development, Infrastructure and Planning", DLGWV: "Local Government, Water and Volunteers",
  DYJVS: "Youth Justice and Victim Support",
  // Commonwealth bodies that fund disaster grants delivered by Queensland, recorded as the funding agency
  DAWR: "Agriculture and Water Resources (Commonwealth)", NRRA: "National Recovery and Resilience Agency (Commonwealth)",
};

type YearFile = { year: string; label: string; url: string };

async function json(url: string): Promise<any> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.qld.gov.au returned ${res.status}`);
  return res.json();
}

// The dataset's CSV files, newest financial year first.
async function listYears(): Promise<YearFile[]> {
  const pkg = (await json(`${CKAN}/package_show?id=${DATASET}`)).result;
  const files: YearFile[] = [];
  for (const r of pkg?.resources ?? []) {
    const m = String(r.name).match(/(\d{4})-(\d{2})\s+consolidated/i);
    if (!m || !/csv/i.test(r.format)) continue;
    const year = `FY${m[1]}-${m[2]}`;
    // 2020-21 is published twice; the later-listed "updated" copy replaces the first.
    const i = files.findIndex((f) => f.year === year);
    const file = { year, label: r.name as string, url: r.url as string };
    if (i >= 0) { if (/updated/i.test(r.name)) files[i] = file; } else files.push(file);
  }
  files.sort((a, b) => b.year.localeCompare(a.year));
  if (files.length === 0) throw new Error("No consolidated expenditure file found on data.qld.gov.au");
  return files;
}

type Parsed = { grants: StateGrant[]; rows: StateGrantRow[]; unknownCodes: string[] };

async function readYear(file: YearFile): Promise<Parsed> {
  const res = await fetch(file.url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`data.qld.gov.au returned ${res.status} for the ${file.year} file`);
  const table = parseCsv(await res.text());
  const head = table[0] ?? [];
  const missing = QGIP_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length > 0) throw new Error(`The ${file.year} file is missing columns: ${missing.join(", ")}`);
  const col = Object.fromEntries(head.map((name, i) => [name, i]));
  const get = (r: string[], name: string) => r[col[name]] ?? "";

  const grants: StateGrant[] = [];
  const rows: StateGrantRow[] = [];
  const unknown = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const value = parseMoney(get(r, "Financial year expenditure"));
    if (value === null) return;
    const fields: Record<string, string> = {};
    for (const c of head) fields[c] = get(r, c);

    const code = get(r, "Funding agency").trim();
    if (code && !AGENCIES[code]) unknown.add(code);
    const abn = get(r, "Australian Business Number (ABN)").replace(/\s/g, "");
    const recipient = get(r, "Legal entity name").trim();
    const validAbn = /^\d{11}$/.test(abn) && abn !== "00000000000";
    const grant: StateGrant = {
      agency: AGENCIES[code] ?? code ?? "Not stated",
      agencyCode: code,
      program: get(r, "Program title"),
      subProgram: get(r, "Sub-program title"),
      purpose: get(r, "Purpose"),
      recipient: recipient || "Not published",
      recipientAbn: validAbn ? abn : null,
      // Individuals are pooled by program with ABN 0 and a label: "Multiple" (the template's word),
      // "Various", "Various - Confidential", "Individual athletes", "Individual names omitted", "NA".
      pooled: !validAbn && (/^(multiple|various|individual|confidential|not applicable)/i.test(recipient) || /^n\/?a$/i.test(recipient) || !recipient),
      recipientType: get(r, "Recipient type"),
      category: get(r, "Category1"),
      assistance: get(r, "Assistance type1"),
      fundingSource: get(r, "Funding source"),
      value,
      agreementTotal: parseMoney(get(r, "Total funding under this agreement to date")),
      start: parseAuDate(get(r, "Funding agreement start")),
      end: parseAuDate(get(r, "Funding agreement end")),
      deliveryLga: get(r, "Service delivery LGA"),
    };
    grants.push(grant);
    // The file is republished whole, so the line's position in it is the stable key.
    rows.push({ state: "QLD", year: file.year, id: String(i + 1), programId: "", sourceUrl: file.url, value, grant, fields });
  });
  return { grants, rows, unknownCodes: [...unknown].sort() };
}

// Uncached: the rows are far too big for the page cache. The index caches the summary alone.
export async function loadQldGrants(): Promise<StateGrantsLoad> {
  const years = await listYears();
  const latest = await readYear(years[0]);
  // The year before, for the change on previous year. Its rows are not kept; see docs/backfill.md.
  let previous: StateGrantSummary["previous"] = null;
  if (years[1]) {
    try {
      const p = await readYear(years[1]);
      previous = { year: years[1].year, count: p.grants.length, totalValue: p.grants.reduce((s, g) => s + g.value, 0) };
    } catch { previous = null; }
  }
  const year = years[0].year.slice(2);
  const summary = summarise(latest.grants, {
    code: "QLD", name: "Queensland", year: years[0].year,
    subject: "paid out by the Queensland government in grants and program funding",
    period: `Financial year ${year}`,
    coverage: `Every grant, subsidy, concession, loan and frontline-service payment made by a Queensland department or the Reconstruction Authority in ${year}, as reported to Queensland Treasury. Payments to individuals are pooled by program under a label such as “Multiple” for privacy. The value is what was paid in the year, not the size of the agreement.`,
    sourceName: "Queensland Treasury, grants and frontline service procurement expenditure data (QGIP)",
    sourceUrl: DATASET_URL,
    fileUrl: years[0].url,
    licence: "CC BY 4.0",
    previous,
    unknownAgencyCodes: latest.unknownCodes,
  });
  return { summary, rows: latest.rows, replaceYears: true };
}
