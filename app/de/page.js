import Link from 'next/link'

export default function Page() {
  return (
    <div>
      <h1>Wind2Horizon</h1>
      <p>Mehrsprachiger Starter. Wähle einen Bereich:</p>
      <ul>
        <li><Link href='/de/map'>Karte</Link></li>
        <li><Link href='/de/auth'>Login</Link></li>
        <li><Link href='/de/vouchers'>Gutscheine</Link></li>
        <li><Link href='/de/partner'>Partner</Link></li>
      </ul>
    </div>
  )
}
