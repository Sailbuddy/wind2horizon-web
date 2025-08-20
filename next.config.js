/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['de', 'en', 'hr', 'fr', 'it'],
    defaultLocale: 'de',
    localeDetection: false, // <-- echtes boolean, NICHT "false"
  },
  // weitere Optionen falls vorhanden …
};

module.exports = nextConfig;
