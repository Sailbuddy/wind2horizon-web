'use client'
import LanguageNav from './LanguageNav'

const SUPPORTED = ['de','en','it','hr','fr']

export default function NavBar({ current='de' }) {
  const lang = SUPPORTED.includes(current) ? current : 'de'
  const beta = 'https://beta.wind2horizon.com'
  const homeHref = lang === 'de' ? `${beta}/` : `${beta}/${lang}/`
  const badge = `W2H • ${lang.toUpperCase()}`

  return (
    <div className="nav">
      <span className="badge">{badge}</span>
      <a className="button" href={homeHref}>Home</a>
      <div style={{marginLeft:'auto'}}>
        <LanguageNav current={lang} />
      </div>
    </div>
  )
}
