import '../globals.css'
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
          <a className="button" href="/it">Home</a>
          <a className="button" href="/it/map">Map</a>
          <a className="button" href="/it/auth">Login</a>
          <a className="button" href="/it/vouchers">Vouchers</a>
          <a className="button" href="/it/partner">Partner</a>
          <div style={{marginLeft:'auto'}}>
            <LanguageNav current="it" />
          </div>
        </div>
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
