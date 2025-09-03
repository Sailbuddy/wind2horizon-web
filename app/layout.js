// app/layout.js
import './globals.css'

export const metadata = {
  title: 'Wind2Horizon',
  description: 'Sailing • Maps • Freedom',
  themeColor: '#39d0fa',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/favicon.ico' } // Fallback für ältere Browser
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180' }
    ]
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
