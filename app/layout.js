import './globals.css'

export const metadata = {
  title: 'Wind2Horizon',
  description: 'Sailing • Maps • Freedom'
}

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
