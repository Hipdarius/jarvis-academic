import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Academic Jarvis",
  description:
    "A private academic command center for deadlines, school files, study planning, and projects.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
