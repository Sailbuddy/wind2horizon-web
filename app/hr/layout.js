import '../globals.css'
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
          <a className="button" href="/hr">Home</a>
          <a className="button" href="/hr/map">Map</a>
          <a className="button" href="/hr/auth">Login</a>
          <a className="button" href="/hr/vouchers">Vouchers</a>
          <a className="button" href="/hr/partner">Partner</a>
          <div style={{marginLeft:'auto'}}>
            <LanguageNav current="hr" />
          </div>
        </div>
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
