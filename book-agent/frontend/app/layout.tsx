import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Editorial AI — Enterprise Manuscript Suite",
  description:
    "Generate full print-ready books in PDF and DOCX using AI. Enterprise-grade manuscript authoring.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;450;500;600;700&family=DM+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,700;0,800;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
