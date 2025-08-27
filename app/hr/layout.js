import '../globals.css'
import NavBar from '../../components/NavBar'

export const metadata = { title: 'Wind2Horizon • hr' }

export default function LocaleLayout({ children }) {
  return (
    <html lang="hr">
      <body>
        <NavBar current="hr" />
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
