// lib/seo.ts
const SITE = "https://wind2horizon.com";

const ogLocaleByLang: Record<string, string> = {
  de: "de_DE",
  en: "en_US",
  it: "it_IT",
  fr: "fr_FR",
  hr: "hr_HR",
};

export function buildLangMetadata(lang: "de" | "en" | "it" | "fr" | "hr") {
  const canonical = `${SITE}/${lang}`;

  return {
    metadataBase: new URL(SITE),

    alternates: {
      canonical,
      languages: {
        de: `${SITE}/de`,
        en: `${SITE}/en`,
        it: `${SITE}/it`,
        fr: `${SITE}/fr`,
        hr: `${SITE}/hr`,
        "x-default": `${SITE}/de`,
      },
    },

    openGraph: {
      url: canonical,
      locale: ogLocaleByLang[lang] ?? "en_US",
      siteName: "Wind2Horizon",
      type: "website",
    },

    // optional, aber oft sinnvoll:
    // twitter: { card: "summary_large_image" },
  } as const;
}
