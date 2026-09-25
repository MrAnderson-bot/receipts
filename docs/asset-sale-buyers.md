# Who bought the Commonwealth's assets: method

Written 25 September 2026. The data is `lib/sources/asset-sale-buyers.ts`; the page is the "Assets sold since
1987" section of `/budget`.

## Why a hand-gathered list

The Department of Finance's past-sales page lists every trade sale and share offer its central sales unit
managed since 1987: the month, the asset and the proceeds. It does not say who bought anything. No official
page does in one place. Each purchaser is, however, on the public record for that sale: in the Audit Office's
report on it, in the minister's media release announcing completion, or in Hansard (most usefully a question
on notice answered on 15 July 1998 that tabled every privatisation to that date with its purchaser).

So the buyers were gathered one sale at a time and written into a list in code, each with the record that
names the buyer, the same way the Victorian contract snapshot is a hand-gathered file with its method stated.
The page prints the source under every buyer so a reader can check it.

## Rules

- **One entry per sale on the Finance list**, matched by the year of sale and a phrase of the name as Finance
  writes it. If Finance rewords a row the buyer disappears ("not traced") rather than attaching to the wrong
  sale.
- **Official record or marked.** `official: true` means the ANAO, Parliament (Hansard, a committee, a tabled
  paper), a department or a minister's release. Where only a secondary source could be found the entry is
  marked `official: false` and the page says "not an official record". On 25 September 2026 all 33 trade sales
  had an official record; two notes say that consortium membership (as opposed to the lessee company) came
  from trade press.
- **Share offers have no buyer entry.** The page says "investors, by public share offer".
- **Split sales list every part** with its buyer and, where the record gives it, its price, separated by
  semicolons: the airports, the Department of Administrative Services businesses, Australian National, ANL.
- **Withheld is recorded as withheld.** The uranium stockpile went to utilities in the United States and Canada
  whose names the Senate was told were confidential; the entry says so rather than guessing.
- **Later ownership is a note, not the buyer.** Who owns the asset now (Thales, Helia, Broadcast Australia,
  Pacific National) goes in the note where the researcher found it; the buyer field is the purchaser at the
  time.
- **Proceeds stay Finance's figure.** Where a release or Hansard gives a different number (the CACS shares,
  Housing Loans Insurance Corporation, ComLand's gross price) the note says so and the table keeps Finance's.

## What is still missing

- The Finance list is only sales its central unit managed. Sales run by agencies, property sales, and the first
  Commonwealth Bank share offer of 1991 are not on it, so neither are their buyers. Adding those sales means a
  second official list; the RBA's December 1997 Bulletin article "Privatisation in Australia" and the Hansard
  table of 15 July 1998 are the candidates.
- Consortium members behind a lessee company (who stood behind Brisbane Airport Corporation, for instance) are
  from trade press for the airports. The ANAO reports name the lessee, not always its shareholders.

## Change log

- 25 September 2026: first list, 33 of 33 trade sales traced, 31 at high confidence and 2 at medium (the ACT
  housing loan schemes, where the Hansard answer predates completion; and the uranium stockpile, where the buyers
  were withheld).
