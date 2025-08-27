import '../globals.css'
import NavBar from '../../components/NavBar'

export const metadata = { title: 'Wind2Horizon • fr' }

export default function LocaleLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <NavBar current="fr" />
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
