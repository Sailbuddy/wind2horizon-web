'use client'

import Link from 'next/link'

export default function Hero({ t, lang }) {
  return (
    <header className="w2h-hero">
      <div className="w2h-hero__overlay">
        <h1 className="w2h-hero__title">{t('hero.title')}</h1>
        <p className="w2h-hero__subtitle">{t('hero.subtitle')}</p>

        <Link href={`/${lang}/map`} className="w2h-hero__cta">
          {t('hero.openMap')}
        </Link>
      </div>
    </header>
  )
}