import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SURE — Safety Understanding, Risk & Evidence",
  description:
    "An agentic workflow layer for pharmacovigilance case processing. Every fact traceable to the page it came from.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
