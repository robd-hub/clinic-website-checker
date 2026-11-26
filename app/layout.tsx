import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://check.designimp.com"),
  title: {
    default: "Clinic website check · Design Imp",
    template: "%s · Design Imp",
  },
  description:
    "Paste your clinic website and get a score out of 100, plus a plain-English list of what to fix. A free tool from Design Imp.",
  openGraph: {
    title: "Clinic website check",
    description:
      "A score out of 100 and a plain list of what to fix, for independent UK clinics.",
    locale: "en_GB",
    siteName: "Design Imp",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB" className={`${dmSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main"
          className="absolute left-4 top-4 z-50 -translate-y-20 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
        >
          Skip to the checker
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
