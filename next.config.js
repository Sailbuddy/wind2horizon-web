/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['de', 'en', 'hr', 'fr', 'it'],
    defaultLocale: 'de',
    localeDetection: false,
  },

  async redirects() {
    return [
      // Root immer auf die Standardsprache
      {
        source: '/',
        destination: '/de',
        permanent: true,
      },
      // Alte Karten-URL -> neue Startseite je Sprache (Karte liegt nun unter /:lang)
      {
        source: '/:lang/map',
        destination: '/:lang',
        permanent: true,
      },
      // Falls es jemals Unterrouten unter /:lang/map/... gab, sicherheitshalber mit abfangen
      {
        source: '/:lang/map/:path*',
        destination: '/:lang/:path*',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
