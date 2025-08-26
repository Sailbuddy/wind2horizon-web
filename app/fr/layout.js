// app/fr/layout.js
import '../globals.css'
import Link from 'next/link'
import LanguageNav from '../../components/LanguageNav'

export const metadata = {
  title: 'Wind2Horizon • fr',
}

export default function LocaleLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <div className="nav">
          <span className="badge">W2H • FR</span>
          {/* Home & Map beide auf die Sprach-Startseite */}
          <Link className="button" href="/fr" locale={false}>Home</Link>
          <Link className="button" href="/fr" locale={false}>Map</Link>
          <Link className="button" href="/fr/auth" locale={false}>Login</Link>
          <Link className="button" href="/fr/vouchers" locale={false}>Vouchers</Link>
          <Link className="button" href="/fr/partner" locale={false}>Partner</Link>

          <div style={{ marginLeft: 'auto' }}>
            <LanguageNav current="fr" />
          </div>
        </div>

        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
