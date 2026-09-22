import Link from "next/link";

// Shown on every page while the site is a work in progress. Says plainly what
// has been collected so far and that it may be incomplete.
export function DevBanner() {
  return (
    <aside className="dev-banner" aria-label="Site status">
      <strong>Under development.</strong> This site is being built in the open and is not finished.
      So far it collects: ABS and RBA economic indicators; Commonwealth revenue, Budget and net debt
      figures from Treasury and Finance; the Tax Office’s corporate tax transparency list; Commonwealth
      contract notices from AusTender and grant awards from GrantConnect; and state contract registers for
      NSW, VIC, QLD, WA, NT, TAS and ACT. Figures are copied from the official publishers and may be
      incomplete, late, or missing where a source did not answer. Nothing here is checked by hand yet.{" "}
      <Link href="/sources">See what each source provides and its current status.</Link>
    </aside>
  );
}
