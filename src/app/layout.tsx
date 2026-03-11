import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KAMTasks",
  description: "Moderne Darkmode-Startseite für KAMTasks",
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
