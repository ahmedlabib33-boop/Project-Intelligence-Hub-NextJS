import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Intelligence Hub",
  description: "Executive project controls website generated from project folders."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
