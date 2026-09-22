// Australian Capital Territory: the live contracts register can't be read by a
// program, but the ACT publishes every invoice of $25,000 or more as open data
// (CC BY 4.0). These are payments made, not contracts awarded.
// https://www.data.act.gov.au/d/kzmf-7uhp
import { USER_AGENT } from "../../xlsx";
import { summarise, type StateContract, type StateSummary } from "./types";

const DATASET = "https://www.data.act.gov.au/resource/kzmf-7uhp.json";
const DAY = 86_400_000;
const WINDOW_DAYS = 365;

export async function loadAct(): Promise<StateSummary> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const query = new URLSearchParams({ $where: `payment_date > '${since}T00:00:00'`, $limit: "50000", $order: "payment_date DESC" });
  const res = await fetch(`${DATASET}?${query}`, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`data.act.gov.au returned ${res.status}`);
  const records: any[] = await res.json();

  const invoices: StateContract[] = [];
  records.forEach((r, i) => {
    const value = Number(r.payment_amount);
    if (!Number.isFinite(value) || value <= 0 || !r.payment_date) return;
    const abn = String(r.supplier_abn ?? "").replace(/\s/g, "");
    invoices.push({
      id: r.contract_number ? String(r.contract_number) : `Invoice ${i + 1}`,
      value, awarded: String(r.payment_date).slice(0, 10),
      agency: r.reporting_entity ?? "Unknown agency",
      supplier: r.supplier_name ?? "Not published",
      supplierAbn: /^\d{11}$/.test(abn) ? abn : null,
      description: r.publish_description ?? "",
      method: "", category: null,
    });
  });

  return summarise(invoices, {
    code: "ACT", name: "Australian Capital Territory", noun: "invoices",
    period: "Paid in the last 12 months",
    coverage: "Invoices of $25,000 and over paid by ACT Government entities. This is money actually paid, not the value of contracts signed, so it isn’t comparable with the other states. The ACT’s contracts register has no data feed.",
    sourceName: "ACT Notifiable Invoices Register",
    sourceUrl: "https://www.data.act.gov.au/d/kzmf-7uhp", licence: "CC BY 4.0",
    filesRead: 1, filesSkipped: [],
  });
}
