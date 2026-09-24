import type { Metadata } from "next";
import "./globals.css";
import AppDialogProvider from "@/components/AppDialogProvider";

export const metadata: Metadata = {
  title: "SIAP ARU",
  description: "Sistem Informasi ARU Terintegrasi",
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="id"><body><AppDialogProvider>{children}</AppDialogProvider></body></html>;
}
