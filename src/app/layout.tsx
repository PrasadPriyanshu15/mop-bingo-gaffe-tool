import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOP Bingo Gaffe Tool",
  description: "MOP Class II bingo gaffe / forcer creation tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
