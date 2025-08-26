// app/hr/layout.js
import '../globals.css'
import Link from 'next/link'
import LanguageNav from '../../components/LanguageNav'

export const metadata = {
  title: 'Wind2Horizon • hr',
}

export default function LocaleLayout({ children }) {
  return (
    <html lang="hr">
      <body>
        <div className="nav">
          <span className="badge">W2H • HR</span>
          {/* Home & Map beide auf die Sprach-Startseite */}
          <Link className="button" href="/hr" locale={false}>Home</Link>
          <Link className="button" href="/hr" locale={false}>Map</Link>
          <Link className="button" href="/hr/auth" locale={false}>Login</Link>
          <Link className="button" href="/hr/vouchers" locale={false}>Vouchers</Link>
          <Link className="button" href="/hr/partner" locale={false}>Partner</Link>

          <div style={{ marginLeft: 'auto' }}>
            <LanguageNav current="hr" />
          </div>
        </div>

        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
