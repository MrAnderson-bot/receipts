// Shared output shapes. Every source module returns these, so pages and any
// later modelling code never need to know where a figure came from.

export type Point = { period: string; value: number }; // period: 2026-07, 2026-Q2, 2026-09-18 or FY2024-25

export type Series = {
  id: string;
  label: string;
  unit: "%" | "pts" | "index" | "AUD" | "USD" | "people" | "number" | "ratio"; // pts: a gap between two percentages; number: a count; ratio: one figure over another
  frequency: "daily" | "monthly" | "quarterly" | "yearly";
  decimals?: number; // decimal places to show, matching how the publisher quotes it (default 1)
  note: string; // what exactly is measured, in plain words
  source: string; // publisher and table
  sourceUrl: string; // where a reader can check it
  points: Point[]; // oldest first
};

export type SeriesResult = { series: Series | null; error: string | null; id: string; label: string };
