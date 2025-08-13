import Link from 'next/link'

export default function Page() {
  return (
    <div>
      <h1>Wind2Horizon</h1>
      <p>Mehrsprachiger Starter. Wähle einen Bereich:</p>
      <ul>
        <li><Link href='/it/map'>Karte</Link></li>
        <li><Link href='/it/auth'>Login</Link></li>
        <li><Link href='/it/vouchers'>Gutscheine</Link></li>
        <li><Link href='/it/partner'>Partner</Link></li>
      </ul>
    </div>
  )
}
