// Plain Node HTTPS for every fuel scheme, not Next's fetch. The loaders run
// inside the static build (the snapshot route), where Next refuses an uncached
// fetch, and a cached one would hold megabytes of station rows per state. The
// eight-hour page cache wraps the loader's summary instead (see index.ts).
import { USER_AGENT } from "../../xlsx";

export type Reply = { status: number; body: string };

export function httpGet(url: string, headers: Record<string, string> = {}, hops = 0): Promise<Reply> {
  const https = (process as any).getBuiltinModule?.("node:https");
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": USER_AGENT, ...headers } }, (res: any) => {
      const to = res.headers.location as string | undefined;
      if (res.statusCode >= 300 && res.statusCode < 400 && to) {
        res.resume();
        if (hops >= 5) return reject(new Error(`Too many redirects from ${url}`));
        return resolve(httpGet(new URL(to, url).toString(), headers, hops + 1));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

export async function httpJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: T | null; body: string }> {
  const r = await httpGet(url, { Accept: "application/json", ...headers });
  let json: T | null = null;
  try { json = JSON.parse(r.body); } catch { json = null; }
  return { ...r, json };
}
