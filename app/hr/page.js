import Link from 'next/link'

export default function Page() {
  return (
    <div>
      <h1>Wind2Horizon</h1>
      <p>Mehrsprachiger Starter. Wähle einen Bereich:</p>
      <ul>
        <li><Link href='/hr/map'>Karte</Link></li>
        <li><Link href='/hr/auth'>Login</Link></li>
        <li><Link href='/hr/vouchers'>Gutscheine</Link></li>
        <li><Link href='/hr/partner'>Partner</Link></li>
      </ul>
    </div>
  )
}
