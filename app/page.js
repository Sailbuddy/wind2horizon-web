import Link from 'next/link'

export default function Home() {
  return (
    <main className="container">
      <div className="nav">
        <span className="badge">Wind2Horizon • Starter</span>
        <div className="langSwitch">
          <Link href="/de">DE</Link>{' | '}<Link href="/en">EN</Link>{' | '}<Link href="/it">IT</Link>{' | '}<Link href="/hr">HR</Link>{' | '}<Link href="/fr">FR</Link>
        </div>
      </div>

      <h1>Willkommen 👋</h1>
      <p>Wähle eine Sprache, um die Demo mit Karte & Login zu sehen.</p>
      <ul>
        <li><Link href="/de">Deutsch</Link></li>
        <li><Link href="/en">English</Link></li>
        <li><Link href="/it">Italiano</Link></li>
        <li><Link href="/hr">Hrvatski</Link></li>
        <li><Link href="/fr">Français</Link></li>
      </ul>
    </main>
  )
}
