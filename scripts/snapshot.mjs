// npm run snapshot: store today's figures in the database and build the site.
//
// The snapshot runs inside `next build` (see app/api/snapshot/route.ts), so
// this just runs a static export with SNAPSHOT=1. The result is a fresh
// data/receipts.db and a complete site in out/. Stop the dev server first if
// it is running: both use the same .next folder.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = { ...process.env, SNAPSHOT: "1", STATIC_EXPORT: "1" };
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const build = spawnSync(cmd, ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

try {
  const stats = JSON.parse(readFileSync("out/api/snapshot", "utf8"));
  console.log(`Database: ${stats.series} series, ${stats.observations} observations, ${stats.snapshots} snapshots, ${stats.companies} companies (${stats.location}).`);
} catch {
  console.log("Build finished, but out/api/snapshot was not written, so the snapshot may not have run.");
  process.exit(1);
}
