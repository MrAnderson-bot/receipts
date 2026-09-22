// Runs the daily snapshot into the local database.
//
// The sources use Next's cache, so the snapshot can only run inside a Next
// process. It runs while the site is being built, when SNAPSHOT=1 is set
// (see scripts/snapshot.mjs), so one build stores the day's figures and
// renders the pages from the same fetches. In the static export this route
// becomes out/api/snapshot, a JSON file with the database totals: nothing on
// the public site can trigger a run.
import { runSnapshot } from "@/lib/db/snapshot";
import { getStore } from "@/lib/db";

export const dynamic = "force-static";

export async function GET() {
  if (process.env.SNAPSHOT === "1") {
    const results = await runSnapshot();
    const failed = results.filter((r) => !r.ok);
    console.log(`Snapshot: saved ${results.length - failed.length} of ${results.length} sources.`);
    for (const f of failed) console.log(`  FAILED ${f.source}: ${f.detail}`);
  }
  return Response.json(await getStore().stats());
}
