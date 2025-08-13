import '../globals.css'
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
          <a className="button" href="/de">Home</a>
          <a className="button" href="/de/map">Map</a>
          <a className="button" href="/de/auth">Login</a>
          <a className="button" href="/de/vouchers">Vouchers</a>
          <a className="button" href="/de/partner">Partner</a>
          <div style={{marginLeft:'auto'}}>
            <LanguageNav current="de" />
          </div>
        </div>
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
