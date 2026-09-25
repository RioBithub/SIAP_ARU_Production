import type { Metadata } from "next";
import "./globals.css";
import AppDialogProvider from "@/components/AppDialogProvider";

export const metadata: Metadata = {
  title: "SIAP ARU",
  description: "Sistem Informasi ARU Terintegrasi",
  icons: {
    icon: "/aru-logo.png",
    shortcut: "/aru-logo.png",
    apple: "/aru-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        {/* Explicit static links make the ARU favicon deterministic in browser + Selenium. */}
        <link rel="icon" type="image/png" href="/aru-logo.png" />
        <link rel="shortcut icon" type="image/png" href="/aru-logo.png" />
        <link rel="apple-touch-icon" href="/aru-logo.png" />
      </head>
      <body>
        <AppDialogProvider>{children}</AppDialogProvider>
      </body>
    </html>
  );
}
