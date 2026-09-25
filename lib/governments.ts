// Federal governments by date, so a figure or an event can be labelled with the government of the day.
// Dates are the day each prime minister was sworn in, from the National Archives' list; a change of
// prime minister within the same party is a new row, so both "who" and "which party" can be read.
// This is a statement of dates only. Outcomes follow policy with a lag, and many figures on this site are
// set by the Reserve Bank, the states or the world rather than by the government of the day.

export type Government = {
  pm: string; // surname as commonly written
  party: "Labor" | "Coalition";
  from: string; // ISO date sworn in
  to: string | null; // ISO date the next government was sworn in; null for the current one
};

export const GOVERNMENTS_SOURCE = "https://www.naa.gov.au/explore-collection/australias-prime-ministers";

export const GOVERNMENTS: Government[] = [
  { pm: "Whitlam", party: "Labor", from: "1972-12-05", to: "1975-11-11" },
  { pm: "Fraser", party: "Coalition", from: "1975-11-11", to: "1983-03-11" },
  { pm: "Hawke", party: "Labor", from: "1983-03-11", to: "1991-12-20" },
  { pm: "Keating", party: "Labor", from: "1991-12-20", to: "1996-03-11" },
  { pm: "Howard", party: "Coalition", from: "1996-03-11", to: "2007-12-03" },
  { pm: "Rudd", party: "Labor", from: "2007-12-03", to: "2010-06-24" },
  { pm: "Gillard", party: "Labor", from: "2010-06-24", to: "2013-06-27" },
  { pm: "Rudd", party: "Labor", from: "2013-06-27", to: "2013-09-18" },
  { pm: "Abbott", party: "Coalition", from: "2013-09-18", to: "2015-09-15" },
  { pm: "Turnbull", party: "Coalition", from: "2015-09-15", to: "2018-08-24" },
  { pm: "Morrison", party: "Coalition", from: "2018-08-24", to: "2022-05-23" },
  { pm: "Albanese", party: "Labor", from: "2022-05-23", to: null },
];

// The government in office on an ISO date (or month, read as its 15th). Null before the list starts.
export function governmentOn(date: string): Government | null {
  const d = date.length === 7 ? `${date}-15` : date;
  return GOVERNMENTS.find((g) => g.from <= d && (g.to === null || d < g.to)) ?? null;
}

// One line for a page: "Howard (Coalition)".
export const governmentLabel = (g: Government | null) => (g ? `${g.pm} (${g.party})` : "before 1972");
