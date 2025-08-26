/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['de', 'en', 'hr', 'fr', 'it'],
    defaultLocale: 'de',
    localeDetection: false,
  },
  async redirects() {
    return [
      // Nur Root → /de (alles andere AUS für den Test)
      { source: '/', destination: '/de', permanent: true },
    ];
  },
};
module.exports = nextConfig;
