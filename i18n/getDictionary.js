// /i18n/getDictionary.js

export const SUPPORTED_LANGS = ['de', 'en', 'it', 'hr', 'fr']
const DEFAULT_LANG = 'de'

function normalizeLang(input) {
  if (!input || typeof input !== 'string') return DEFAULT_LANG
  const l = input.toLowerCase()
  return SUPPORTED_LANGS.includes(l) ? l : DEFAULT_LANG
}

/**
 * Lädt das Sprach-Dictionary als JSON.
 * - Nutzt nur SUPPORTED_LANGS
 * - Fallback auf DEFAULT_LANG, falls Datei fehlt
 */
export async function getDictionary(lang) {
  const safe = normalizeLang(lang)

  try {
    const dict = (await import(`./${safe}.json`)).default
    return dict
  } catch (e) {
    // Fallback (z. B. wenn de.json fehlt -> sehr unwahrscheinlich)
    const dict = (await import(`./${DEFAULT_LANG}.json`)).default
    return dict
  }
}
