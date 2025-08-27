import '../globals.css'
import NavBar from '../../components/NavBar'

export const metadata = { title: 'Wind2Horizon • it' }

export default function LocaleLayout({ children }) {
  return (
    <html lang="it">
      <body>
        <NavBar current="it" />
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
