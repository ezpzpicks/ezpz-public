import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./mobile-shell.css";
import "./sitewide.css";

const description = "NBA, NCAAM, NFL, NCAAF and MLB slates, model projections, manually selected EZPZ Picks, and transparent performance tracking.";
export const metadata: Metadata = {
  metadataBase: new URL("https://ezpzpicks.com"),
  title: "EZPZ Picks | Multi-Sport Slates & Picks",
  description,
  openGraph: { type: "website", url: "https://ezpzpicks.com", siteName: "EZPZ Picks",
    title: "EZPZ Picks", description, images: [{ url: "/share-image", width: 1200, height: 630, alt: "EZPZ Picks — multi-sport slates, projections and official picks" }] },
  twitter: { card: "summary_large_image", title: "EZPZ Picks", description,
    images: ["/share-image"] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
