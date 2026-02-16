// app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import { headers } from "next/headers";

export const metadata = {
  metadataBase: new URL("https://wind2horizon.com"),
  applicationName: "Wind2Horizon",
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.ico" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0ea5e9",
};

const ALLOWED = new Set(["de", "en", "it", "fr", "hr"]);

export default function RootLayout({ children }: { children: ReactNode }) {
  const h = headers();
  const lang = h.get("x-w2h-lang") ?? "en";
  const safeLang = ALLOWED.has(lang) ? lang : "en";

  return (
    <html lang={safeLang}>
      <body>{children}</body>
    </html>
  );
}
