/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['de', 'en', 'hr', 'fr', 'it'],
    defaultLocale: 'de',
    localeDetection: false,
  },
  async redirects() {
    return [];
  },
};
module.exports = nextConfig;