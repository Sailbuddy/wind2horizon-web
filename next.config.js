/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['de', 'en', 'it', 'hr', 'fr'],
    defaultLocale: 'de',
    localeDetection: true
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ]
  }
}
module.exports = nextConfig
