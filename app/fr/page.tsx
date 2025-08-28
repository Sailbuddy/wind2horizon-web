import Hero from '@/components/Hero'
import { getDictionary } from '@/i18n/getDictionary'

export default async function LocalizedHome({ params: { lang } }) {
  const dict = await getDictionary(lang)

  const t = (key) =>
    key.split('.').reduce((o, k) => (o ? o[k] : ''), dict)

  return (
    <>
      <Hero t={t} lang={lang} />
      <section className="w2h-intro">
        <p>{t('intro.text')}</p>
      </section>
    </>
  )
}
