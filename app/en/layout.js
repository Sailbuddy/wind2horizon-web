import '../globals.css'
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
          <a className="button" href="/en">Home</a>
          <a className="button" href="/en/map">Map</a>
          <a className="button" href="/en/auth">Login</a>
          <a className="button" href="/en/vouchers">Vouchers</a>
          <a className="button" href="/en/partner">Partner</a>
          <div style={{marginLeft:'auto'}}>
            <LanguageNav current="en" />
          </div>
        </div>
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
