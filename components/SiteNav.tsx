"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/economy", label: "Economy" },
  { href: "/revenue", label: "Revenue" },
  { href: "/budget", label: "Budget" },
  { href: "/companies", label: "Companies" },
  { href: "/spending", label: "Contracts" },
  { href: "/categories", label: "Categories" },
  { href: "/grants", label: "Grants" },
  { href: "/states", label: "States" },
  { href: "/migration", label: "Migration" },
  { href: "/parliament", label: "Parliament" },
  { href: "/revisions", label: "Revisions" },
  { href: "/sources", label: "Sources" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <header className="top">
      <Link href="/" className="brand">Receipts</Link>
      <nav aria-label="Sections">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href || (l.href !== "/" && path.startsWith(l.href + "/")) ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
