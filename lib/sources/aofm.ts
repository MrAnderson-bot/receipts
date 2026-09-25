// Australian Government Securities on issue, from the Australian Office of
// Financial Management's data hub (CC BY 4.0). This is the gross face value
// of Treasury Bonds, Indexed Bonds and Notes outstanding: the debt the AOFM
// manages, before the Commonwealth's financial assets are netted off. It is
// not the same figure as net debt in the Budget.
//
// Two files on the data hub are read, found by name on the page because their
// paths carry an upload date:
//   Register of Government Borrowings  monthly, face value, since 2010
//   Portfolio aggregate, executive summary  one column per June, plus the latest month
// The register gives the history; the summary's last column is added when it
// is newer than the register's last month.
import { readWorkbook, excelDate, USER_AGENT, type Row } from "../xlsx";
import type { Series, Point } from "./types";

const HUB = "https://www.aofm.gov.au/data-hub";
const headers = { "User-Agent": USER_AGENT };

async function hubLink(pattern: RegExp): Promise<string> {
  const res = await fetch(HUB, { headers, next: { revalidate: 21_600 } });
  if (!res.ok) throw new Error(`AOFM returned ${res.status} for the data hub page`);
  const html = await res.text();
  const m = html.match(new RegExp(`href="([^"]*${pattern.source}[^"]*\\.xlsx)"`, "i"));
  if (!m) throw new Error(`No link matching ${pattern.source} on the AOFM data hub page`);
  return new URL(m[1], HUB).toString();
}

async function book(url: string) {
  const res = await fetch(url, { headers, next: { revalidate: 21_600 } });
  if (!res.ok) throw new Error(`AOFM returned ${res.status} for ${url}`);
  return readWorkbook(Buffer.from(await res.arrayBuffer()));
}

const month = (serial: string) => excelDate(serial)?.slice(0, 7) ?? null;

async function registerPoints(): Promise<{ points: Point[]; url: string }> {
  const url = await hubLink(/register_of_government_borrowing/);
  const rows = book(url).then((b) => b.sheet("Holdings_FaceValue"));
  const sheet = await rows;
  const header = sheet.find((r) => Object.values(r).some((v) => /^Issued by Cwlth$/i.test(v.trim())));
  const col = header && Object.entries(header).find(([, v]) => /^Issued by Cwlth$/i.test(v.trim()))?.[0];
  if (!col) throw new Error("AOFM register has no 'Issued by Cwlth' column; the layout may have changed");
  const points: Point[] = [];
  for (const r of sheet) {
    const period = /^\d{4,6}$/.test((r.A ?? "").trim()) ? month(r.A) : null;
    const value = Number(r[col]);
    if (period && Number.isFinite(value) && value > 0) points.push({ period, value });
  }
  if (!points.length) throw new Error("AOFM register has no monthly figures");
  points.sort((a, b) => a.period.localeCompare(b.period));
  return { points, url };
}

async function latestFromSummary(): Promise<Point | null> {
  const url = await hubLink(/executive_summary/);
  const rows = (await book(url)).sheet("Portfolio");
  const header = rows.find((r) => /^Currency of Issue/i.test((r.B ?? "").trim()));
  const total = rows.find((r) => /^Total AUD Main Funding Instruments$/i.test((r.D ?? "").trim()));
  if (!header || !total) return null;
  const dated = Object.entries(header).filter(([c, v]) => c !== "A" && c !== "B" && c !== "C" && c !== "D" && /^\d{4,6}$/.test(v.trim()));
  const last = [...dated].reverse().find(([c]) => Number.isFinite(Number(total[c])) && total[c] !== "");
  if (!last) return null;
  const period = month(last[1]);
  return period ? { period, value: Math.abs(Number(total[last[0]])) } : null;
}

export async function fetchAgs(): Promise<Series> {
  const { points, url } = await registerPoints();
  const extra = await latestFromSummary().catch(() => null);
  if (extra && extra.period > points[points.length - 1].period) points.push(extra);
  return {
    id: "ags-on-issue",
    label: "Government securities on issue",
    unit: "AUD",
    frequency: "monthly",
    decimals: 1,
    note:
      "Face value of Treasury Bonds, Treasury Indexed Bonds and Treasury Notes outstanding at month end: the Commonwealth's gross debt " +
      "as the AOFM manages it. Net debt in the Budget is smaller because it subtracts the government's financial assets.",
    source: "AOFM, Register of Government Borrowings",
    sourceUrl: url,
    points,
  };
}

export async function tryGetAgs(): Promise<{ data: Series | null; error: string | null }> {
  try { return { data: await fetchAgs(), error: null }; }
  catch (e) { return { data: null, error: e instanceof Error ? e.message : String(e) }; }
}
