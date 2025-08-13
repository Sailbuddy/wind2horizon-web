import Link from 'next/link'

export default function Page() {
  return (
    <div>
      <h1>Wind2Horizon</h1>
      <p>Mehrsprachiger Starter. Wähle einen Bereich:</p>
      <ul>
        <li><Link href='/fr/map'>Karte</Link></li>
        <li><Link href='/fr/auth'>Login</Link></li>
        <li><Link href='/fr/vouchers'>Gutscheine</Link></li>
        <li><Link href='/fr/partner'>Partner</Link></li>
      </ul>
    </div>
  )
}
