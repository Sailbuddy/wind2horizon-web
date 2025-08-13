import Link from 'next/link'

export default function Page() {
  return (
    <div>
      <h1>Wind2Horizon</h1>
      <p>Mehrsprachiger Starter. Wähle einen Bereich:</p>
      <ul>
        <li><Link href='/en/map'>Karte</Link></li>
        <li><Link href='/en/auth'>Login</Link></li>
        <li><Link href='/en/vouchers'>Gutscheine</Link></li>
        <li><Link href='/en/partner'>Partner</Link></li>
      </ul>
    </div>
  )
}
