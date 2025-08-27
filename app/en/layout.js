import '../globals.css'
import NavBar from '../../components/NavBar'

export const metadata = { title: 'Wind2Horizon • en' }

export default function LocaleLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NavBar current="en" />
        <main className="container">{children}</main>
        <div className="footer">© Wind2Horizon</div>
      </body>
    </html>
  )
}
