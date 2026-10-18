import { translate, type Locale } from './messages'
import { SITE_URL, type PagePath } from './routes'

export function pageMetadata(path: PagePath, locale: Locale) {
  // The automatic entry point has one stable, English sharing preview.
  const sharingLocale = path === '/' ? 'en' : locale
  const url = `${SITE_URL}${path}`
  return {
    title: translate(locale, 'pageTitle'),
    description: translate(locale, 'pageDescription'),
    url,
    image: `${SITE_URL}/og-image.png`,
    sharingLocale: sharingLocale === 'ja' ? 'ja_JP' : 'en_US',
    sharingTitle: translate(sharingLocale, 'pageTitle'),
    sharingDescription: translate(sharingLocale, 'shareDescription'),
    imageAlt: translate(sharingLocale, 'shareImageAlt'),
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Screen Recorder',
      url,
      description: translate(locale, 'appDescription'),
      image: `${SITE_URL}/og-image.png`,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'macOS, Windows',
      browserRequirements: 'Requires JavaScript and the latest desktop Google Chrome.',
      inLanguage: ['ja', 'en'],
      isAccessibleForFree: true,
      license: 'https://opensource.org/license/mit',
    },
  }
}

export function updatePageMetadata(path: PagePath, locale: Locale): void {
  const meta = pageMetadata(path, locale)
  document.documentElement.lang = locale
  document.title = meta.title
  const setMeta = (selector: string, content: string) =>
    document.querySelector(selector)?.setAttribute('content', content)
  setMeta('meta[name="description"]', meta.description)
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', meta.url)
  setMeta('meta[property="og:url"]', meta.url)
  setMeta('meta[property="og:locale"]', meta.sharingLocale)
  setMeta('meta[property="og:title"]', meta.sharingTitle)
  setMeta('meta[property="og:description"]', meta.sharingDescription)
  setMeta('meta[property="og:image:alt"]', meta.imageAlt)
  setMeta('meta[name="twitter:title"]', meta.sharingTitle)
  setMeta('meta[name="twitter:description"]', meta.sharingDescription)
  setMeta('meta[name="twitter:image:alt"]', meta.imageAlt)
  const structuredData = document.querySelector('script[type="application/ld+json"]')
  if (structuredData) structuredData.textContent = JSON.stringify(meta.structuredData)
}
