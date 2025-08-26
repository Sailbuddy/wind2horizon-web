// app/de/layout.js
import '../globals.css'
import Link from 'next/link'
import LanguageNav from '../../components/LanguageNav'

export const metadata = {
  title: 'Wind2Horizon • de',
}

export default function LocaleLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <div className="nav">
          <span className="badge">W2H • DE</span>
          {/* Home & Map gehen beide auf die Sprach-Startseite */}
          <Link className="button" href="/de" locale={false}>Home</Link>
          <Link className="button" href="/de" locale={false}>Map</Link>
          <Link className="button" href="/de/auth" locale={false}>Login</Link>
          <Link className="button" href="/de/vouchers" locale={false}>Vouchers</Link>
          <Link className="button" href="/de/partner" locale={false}>Partner</Link>

          <div style={{ marginLeft: 'auto' }}>
            <LanguageNav current="de" />
          </div>
        </div>

        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}