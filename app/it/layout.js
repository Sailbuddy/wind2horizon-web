// app/it/layout.js
import '../globals.css'
import Link from 'next/link'
import LanguageNav from '../../components/LanguageNav'

export const metadata = {
  title: 'Wind2Horizon • it',
}

export default function LocaleLayout({ children }) {
  return (
    <html lang="it">
      <body>
        <div className="nav">
          <span className="badge">W2H • IT</span>
          {/* Home & Map beide auf die Sprach-Startseite */}
          <Link className="button" href="/it" locale={false}>Home</Link>
          <Link className="button" href="/it" locale={false}>Map</Link>
          <Link className="button" href="/it/auth" locale={false}>Login</Link>
          <Link className="button" href="/it/vouchers" locale={false}>Vouchers</Link>
          <Link className="button" href="/it/partner" locale={false}>Partner</Link>

          <div style={{ marginLeft: 'auto' }}>
            <LanguageNav current="it" />
          </div>
        </div>

        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
