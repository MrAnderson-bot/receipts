// npm run backfill -- contracts:FY2025-26 [--minutes 20]
//
// Fills one unit of history into data/receipts.db (see docs/backfill.md), resumably: run it again
// and it carries on from where it stopped. Runs in plain Node, outside Next, through the TypeScript
// loader in scripts/ts-loader.mjs. Safe to run while the dev server is up; don't run two at once.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(process.cwd() + "/scripts/ts-loader.mjs"));

const args = process.argv.slice(2);
const unit = args.find((a) => !a.startsWith("--"));
const minutes = Number(args[args.indexOf("--minutes") + 1] || 0) || 20;
if (!unit) { console.error("Usage: npm run backfill -- contracts:FY2025-26 [--minutes 20]"); process.exit(2); }

const { runBackfill } = await import(pathToFileURL(process.cwd() + "/lib/db/backfill.ts"));
const t0 = Date.now();
const p = await runBackfill(unit, { minutes, log: (line) => console.log(new Date().toISOString().slice(11, 19), line) });
console.log(`${p.unit}: ${p.status}, ${p.rowsAdded} rows, ${p.calls} API calls, ${Math.round((Date.now() - t0) / 1000)}s${p.cursor && p.status !== "done" ? `, cursor ${p.cursor.slice(0, 10)}` : ""}`);
