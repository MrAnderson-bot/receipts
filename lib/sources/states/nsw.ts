// New South Wales: buy.nsw's register of notices has a public report form that
// exports contract award notices as CSV for any date range.
// https://buy.nsw.gov.au/notices/notice-reports
import { parseCsv, parseMoney, parseAuDate } from "../../csv";
import { USER_AGENT } from "../../xlsx";
import { summarise, type StateContract, type StateSummary } from "./types";

const REPORT = "https://buy.nsw.gov.au/notices/notice-reports";
const DAY = 86_400_000;
const WINDOW_DAYS = 365;

// "construction>building-upgrades-projects" -> "Construction"
const tidyCategory = (raw: string) => {
  const top = raw.split(">")[0].replace(/-/g, " ").trim();
  return top ? top[0].toUpperCase() + top.slice(1) : null;
};

export async function loadNsw(): Promise<StateSummary> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const body = new URLSearchParams({
    query: "", noticeType: "can", agencyUUID: "", category: "",
    dateFrom: day(new Date(Date.now() - WINDOW_DAYS * DAY)), dateTo: day(new Date()),
    export: "1", // the form's "export" button
  });
  const res = await fetch(REPORT, {
    method: "POST", body, cache: "no-store",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Referer: REPORT },
  });
  // buy.nsw sits behind a bot check that answers 202 with an empty body when it wants a browser.
  if (res.status === 202) throw new Error("buy.nsw asked for a browser check instead of sending the report. It usually clears within the hour.");
  if (!res.ok) throw new Error(`buy.nsw returned ${res.status}`);
  if (!/csv/i.test(res.headers.get("content-type") ?? "")) throw new Error("buy.nsw returned a web page instead of the report; the form may have changed");

  const rows = parseCsv(await res.text());
  const col = Object.fromEntries(rows[0].map((name, i) => [name, i]));
  const get = (r: string[], name: string) => r[col[name]] ?? "";

  const seen = new Map<string, StateContract>();
  for (const r of rows.slice(1)) {
    const id = get(r, "Notice ID");
    const value = parseMoney(get(r, "Contract value"));
    const awarded = parseAuDate(get(r, "Publish date"));
    if (!id || value === null || value <= 0 || !awarded || get(r, "Publish status") !== "published") continue;
    const abn = get(r, "Contractor ABN").replace(/\s/g, "");
    // A contract shared between suppliers gets one notice each, all showing the full value. Count it once.
    const key = `${get(r, "Department/Agency")}|${get(r, "Notice title")}|${value}`;
    const shared = seen.get(key);
    if (shared) { shared.supplier = "Several suppliers"; shared.supplierAbn = null; continue; }
    seen.set(key, {
      id, value, awarded,
      agency: get(r, "Department/Agency") || "Unknown agency",
      supplier: get(r, "Contractor name") || "Not published",
      supplierAbn: /^\d{11}$/.test(abn) ? abn : null,
      description: get(r, "Notice title"),
      method: "", // the report doesn't say how the contract was awarded
      category: tidyCategory(get(r, "Category")),
    });
  }

  return summarise([...seen.values()], {
    code: "NSW", name: "New South Wales", noun: "contracts",
    period: "Published in the last 12 months",
    coverage: "Contract award notices on buy.nsw. NSW agencies must publish contracts of $150,000 and over within 45 working days. The report doesn’t record the procurement method, so that section is empty. Dates are the day the notice was published.",
    sourceName: "buy.nsw register of notices, contract award report",
    sourceUrl: REPORT, licence: "CC BY 4.0",
    filesRead: 1, filesSkipped: [],
  });
}
