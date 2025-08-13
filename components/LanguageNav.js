'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const languages = ['de', 'en', 'it', 'hr', 'fr']

export default function LanguageNav({ current }) {
  const pathname = usePathname() || '/'
  const rest = pathname.replace(/^\/([a-z]{2})(\/|$)/, '/')

  return (
    <div className="langSwitch">
      {languages.map((lng, idx) => (
        <span key={lng}>
          <Link href={`/${lng}${rest}`}
            className={lng === current ? 'code' : ''}>{lng.toUpperCase()}
          </Link>
          {idx < languages.length - 1 ? ' | ' : ''}
        </span>
      ))}
    </div>
  )
}
