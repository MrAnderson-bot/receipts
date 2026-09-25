// Lets plain Node run the project's TypeScript outside Next (Node 22.6+ strips types itself).
// Two things Next's bundler resolves that Node's ESM loader won't: extensionless relative imports
// ("../unspsc" -> "../unspsc.ts") and bare package subpaths without ".js" ("next/cache").
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/i.test(specifier) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(fileURLToPath(base) + ext)) return next(base.href + ext, context);
    }
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && !/\.[cm]?js$/.test(specifier) && !specifier.startsWith(".")) return next(specifier + ".js", context);
    throw e;
  }
}
