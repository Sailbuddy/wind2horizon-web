// app/en/layout.js
import '../globals.css'
import Link from 'next/link'
import LanguageNav from '../../components/LanguageNav'

export const metadata = {
  title: 'Wind2Horizon • en',
}

export default function LocaleLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="nav">
          <span className="badge">W2H • EN</span>
          {/* Home & Map beide auf die Sprach-Startseite */}
          <Link className="button" href="/en" locale={false}>Home</Link>
          <Link className="button" href="/en" locale={false}>Map</Link>
          <Link className="button" href="/en/auth" locale={false}>Login</Link>
          <Link className="button" href="/en/vouchers" locale={false}>Vouchers</Link>
          <Link className="button" href="/en/partner" locale={false}>Partner</Link>

          <div style={{ marginLeft: 'auto' }}>
            <LanguageNav current="en" />
          </div>
        </div>

        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
