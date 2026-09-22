// STATIC_EXPORT=1 builds the site as plain files in out/ for Cloudflare Pages.
// Every page is rendered once at build time from the live sources, so the
// build is the daily refresh. Without the flag it is the normal dev server.
const isStatic = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
export default {
  output: isStatic ? "export" : undefined,
  trailingSlash: isStatic, // /spending/ -> out/spending/index.html, which any static host serves
  // Pages read every source at build time and the snapshot runs there too, so
  // allow well over the 60-second default before a page is declared stuck.
  staticPageGenerationTimeout: 600,
};
