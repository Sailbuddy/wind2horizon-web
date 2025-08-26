'use client'
import Link from 'next/link'

const languages = ['de', 'en', 'it', 'hr', 'fr']

export default function LanguageNav({ current }) {
  return (
    <div className="langSwitch">
      {languages.map((lng, idx) => (
        <span key={lng}>
          <Link
            href={`/${lng}`}     // immer zur Sprach-Root
            locale={false}       // verhindert /en/de & Co.
            className={lng === current ? 'code' : ''}
          >
            {lng.toUpperCase()}
          </Link>
          {idx < languages.length - 1 ? ' | ' : ''}
        </span>
      ))}
    </div>
  )
}
