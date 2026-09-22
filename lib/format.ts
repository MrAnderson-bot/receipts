const compact = new Intl.NumberFormat("en-AU", {
  style: "currency", currency: "AUD", notation: "compact", maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat("en-AU", {
  style: "currency", currency: "AUD", maximumFractionDigits: 0,
});
export const money = (n: number) => compact.format(n);
export const moneyFull = (n: number) => full.format(n);
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const num = (n: number) => n.toLocaleString("en-AU");

type Unit = "%" | "index" | "AUD" | "USD" | "people";
const fixed = (n: number, d: number) =>
  n.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d });

// A series value in its own unit, e.g. 4.5%, US$0.6650, 27.92M, 305,570.
export function value(n: number, unit: Unit, decimals = 1): string {
  if (unit === "%") return `${fixed(n, decimals)}%`;
  if (unit === "USD") return `US$${fixed(n, decimals)}`;
  if (unit === "AUD") return money(n);
  if (unit === "people") return Math.abs(n) >= 1e6 ? `${fixed(n / 1e6, decimals)}M` : num(Math.round(n));
  return fixed(n, decimals);
}

// Signed change between two observations. Percent series move in points.
export function delta(n: number, unit: Unit, decimals = 1): string {
  const places = unit === "people" ? 0 : decimals;
  if (Number(Math.abs(n).toFixed(places)) === 0) return "unchanged";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (unit === "%") return `${sign}${fixed(abs, decimals)} pts`;
  if (unit === "people") return `${sign}${num(Math.round(abs))}`;
  return `${sign}${fixed(abs, decimals)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 2026-07 -> Jul 2026, 2026-Q2 -> Jun qtr 2026, 2026-09-18 -> 18 Sep 2026, FY2024-25 -> 2024-25
// Financial years carry an FY prefix because 2011-12 would otherwise read as December 2011.
export function period(p: string): string {
  if (p.startsWith("FY")) return p.slice(2);
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${MONTHS[Number(q[2]) * 3 - 1]} qtr ${q[1]}`;
  const d = p.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!d) return p;
  const month = `${MONTHS[Number(d[2]) - 1]} ${d[1]}`;
  return d[3] ? `${Number(d[3])} ${month}` : month;
}

export const onPrevious = (d: string) => (d === "unchanged" ? "unchanged on previous" : `${d} on previous`);
