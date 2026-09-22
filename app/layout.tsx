import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { DevBanner } from "@/components/DevBanner";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font" });

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
        </main>
      </body>
    </html>
  );
}
