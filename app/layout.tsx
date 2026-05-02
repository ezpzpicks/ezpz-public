import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "EZPZ Picks",
  description: "Premium MLB model plays, daily slate insights, and record tracking powered by the EZPZ betting algorithm.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
