import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { DevBanner } from "@/components/DevBanner";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font" });

// The site is a static build, so this is the time the pages were rendered and every source read.
const builtAt = () => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" }).format(new Date());

export const metadata: Metadata = {
  title: { default: "Receipts: the Australian economy, from the source", template: "%s | Receipts" },
  description: "Live figures on the Australian economy and Commonwealth spending, pulled from official sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={archivo.variable}>
      <body>
        <main>
          <SiteNav />
          <DevBanner />
          {children}
          <p className="built">
            Figures read {builtAt()} Canberra time. The site is rebuilt about four times a day; what each read did, and anything that
            failed, is on the <a href="/sources/">Sources</a> page.
          </p>
        </main>
      </body>
    </html>
  );
}
