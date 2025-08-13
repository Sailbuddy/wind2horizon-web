import '../globals.css'
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
          <a className="button" href="/fr">Home</a>
          <a className="button" href="/fr/map">Map</a>
          <a className="button" href="/fr/auth">Login</a>
          <a className="button" href="/fr/vouchers">Vouchers</a>
          <a className="button" href="/fr/partner">Partner</a>
          <div style={{marginLeft:'auto'}}>
            <LanguageNav current="fr" />
          </div>
        </div>
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
