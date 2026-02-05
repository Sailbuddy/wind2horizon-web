// lib/seo.ts
import type { Metadata } from "next";

export function buildLangMetadata(lang: string): Metadata {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://wind2horizon.com";

  const titles: Record<string, string> = {
    de: "Wind2Horizon",
    en: "Wind2Horizon",
    it: "Wind2Horizon",
    fr: "Wind2Horizon",
    hr: "Wind2Horizon",
  };

  const descriptions: Record<string, string> = {
    de: "Interaktive Karte, Segelspots, Wetter und Wissen.",
    en: "Interactive map, sailing spots, weather and knowledge.",
    it: "Mappa interattiva, spot di vela e meteo.",
    fr: "Carte interactive, spots nautiques et météo.",
    hr: "Interaktivna karta, jedriličarske lokacije i vrijeme.",
  };

  const title = titles[lang] ?? titles.en;
  const description = descriptions[lang] ?? descriptions.en;

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    alternates: {
      languages: {
        de: "/de",
        en: "/en",
        it: "/it",
        fr: "/fr",
        hr: "/hr",
      },
    },
    openGraph: {
      title,
      description,
      siteName: "Wind2Horizon",
      type: "website",
      url: `/${lang}`,
    },
  };
}
