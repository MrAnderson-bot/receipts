"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Two levels: a short bar of groups, and the pages of the current group underneath it.
// A group's link goes to its first page. A group with one page is just a link.
type Page = { href: string; label: string };
type Group = { label: string; pages: Page[] };

const GROUPS: Group[] = [
  {
    label: "Overview",
    pages: [
      { href: "/", label: "Overview" },
      { href: "/scorecard", label: "Scorecard" },
    ],
  },
  {
    label: "Economy",
    pages: [
      { href: "/economy", label: "Indicators" },
      { href: "/fuel", label: "Fuel" },
    ],
  },
  {
    label: "Budget",
    pages: [
      { href: "/budget", label: "Budget" },
      { href: "/revenue", label: "Revenue" },
      { href: "/companies", label: "Companies" },
      { href: "/government", label: "Public service" },
    ],
  },
  {
    label: "Spending",
    pages: [
      { href: "/spending", label: "Contracts" },
      { href: "/categories", label: "Categories" },
      { href: "/grants", label: "Grants" },
      { href: "/expenses", label: "Expenses" },
      { href: "/states", label: "States" },
    ],
  },
  {
    label: "People",
    pages: [
      { href: "/migration", label: "Migration" },
      { href: "/crime", label: "Crime" },
    ],
  },
  { label: "Parliament", pages: [{ href: "/parliament", label: "Parliament" }] },
  {
    label: "Data",
    pages: [
      { href: "/sources", label: "Sources" },
      { href: "/revisions", label: "Revisions" },
    ],
  },
];

const isOn = (path: string, href: string) => path === href || (href !== "/" && path.startsWith(href + "/"));

export function SiteNav() {
  const path = usePathname();
  const current = GROUPS.find((g) => g.pages.some((p) => isOn(path, p.href)));
  return (
    <header className="top">
      <Link href="/" className="brand">Receipts</Link>
      <nav aria-label="Sections">
        {GROUPS.map((g) => (
          <Link key={g.label} href={g.pages[0].href} aria-current={g === current ? "true" : undefined}>
            {g.label}
          </Link>
        ))}
      </nav>
      {current && current.pages.length > 1 && (
        <nav className="sub" aria-label={`${current.label} pages`}>
          {current.pages.map((p) => (
            <Link key={p.href} href={p.href} aria-current={isOn(path, p.href) ? "page" : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
