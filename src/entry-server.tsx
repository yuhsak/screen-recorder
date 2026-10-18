import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import App from './App'
import { pageMetadata } from './i18n/metadata'
import { translate } from './i18n/messages'
import { pagePath, pathLocale, SITE_URL, type PagePath } from './i18n/routes'

function PageHead({ path }: { path: PagePath }) {
  const meta = pageMetadata(path, pathLocale(path) ?? 'en')
  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={meta.url} />
      <link rel="alternate" hrefLang="en" href={`${SITE_URL}/en/`} />
      <link rel="alternate" hrefLang="ja" href={`${SITE_URL}/ja/`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}/`} />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content={meta.sharingLocale} />
      <meta property="og:site_name" content="Screen Recorder" />
      <meta property="og:title" content={meta.sharingTitle} />
      <meta property="og:description" content={meta.sharingDescription} />
      <meta property="og:url" content={meta.url} />
      <meta property="og:image" content={meta.image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={meta.imageAlt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={meta.sharingTitle} />
      <meta name="twitter:description" content={meta.sharingDescription} />
      <meta name="twitter:image" content={meta.image} />
      <meta name="twitter:image:alt" content={meta.imageAlt} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(meta.structuredData).replace(/</g, '\\u003c'),
        }}
      />
    </>
  )
}

// Used only by Vite during development/build; production serves static HTML.
export function renderPage(template: string, pathname: string): string {
  const path = pagePath(pathname)
  const locale = pathLocale(path) ?? 'en'
  const parts: Record<string, string> = {
    '<!--page-head-->': renderToStaticMarkup(<PageHead path={path} />),
    '<!--app-html-->': renderToString(<App pageLocale={locale} unsupported={null} />),
    '<!--page-noscript-->': renderToStaticMarkup(
      <noscript>
        <p>{translate(locale, 'javascriptRequired')}</p>
        <nav aria-label={translate(locale, 'language')}>
          <a href="/en/" hrefLang="en" lang="en">
            English
          </a>
          {' · '}
          <a href="/ja/" hrefLang="ja" lang="ja">
            日本語
          </a>
        </nav>
      </noscript>,
    ),
  }
  let html = template.replace('<html lang="en">', `<html lang="${locale}">`)
  for (const [marker, content] of Object.entries(parts)) {
    if (!html.includes(marker)) throw new Error(`Missing HTML placeholder: ${marker}`)
    html = html.replace(marker, () => content)
  }
  return html
}
