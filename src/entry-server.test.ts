// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import template from '../index.html?raw'
import sitemap from '../public/sitemap.xml?raw'
import { renderPage } from './entry-server'
import { en } from './i18n/en'
import { ja } from './i18n/ja'
import { PAGE_PATHS, SITE_URL } from './i18n/routes'

describe('static language pages', () => {
  it.each(PAGE_PATHS)(
    'renders localized content and SEO metadata without a browser: %s',
    (path) => {
      const locale = path === '/ja/' ? 'ja' : 'en'
      const messages = locale === 'ja' ? ja : en
      let html: string
      vi.stubGlobal('window', undefined)
      try {
        html = renderPage(template, path)
      } finally {
        vi.unstubAllGlobals()
      }
      const document = new DOMParser().parseFromString(html, 'text/html')
      const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content')

      expect(document.documentElement.lang).toBe(locale)
      expect(document.title).toBe(messages.pageTitle)
      expect(meta('meta[name="description"]')).toBe(messages.pageDescription)
      expect(meta('meta[property="og:title"]')).toBe(messages.pageTitle)
      expect(meta('meta[property="og:description"]')).toBe(messages.shareDescription)
      expect(meta('meta[property="og:url"]')).toBe(`${SITE_URL}${path}`)
      expect(meta('meta[property="og:locale"]')).toBe(locale === 'ja' ? 'ja_JP' : 'en_US')
      expect(meta('meta[name="twitter:description"]')).toBe(messages.shareDescription)
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `${SITE_URL}${path}`,
      )
      expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(3)
      for (const [language, url] of [
        ['en', '/en/'],
        ['ja', '/ja/'],
        ['x-default', '/'],
      ]) {
        expect(document.querySelector(`link[hreflang="${language}"]`)?.getAttribute('href')).toBe(
          `${SITE_URL}${url}`,
        )
      }
      const data = JSON.parse(
        document.querySelector('script[type="application/ld+json"]')!.textContent!,
      )
      expect(data).toMatchObject({
        url: `${SITE_URL}${path}`,
        description: messages.appDescription,
        inLanguage: ['ja', 'en'],
      })
      expect(document.querySelector('#root')?.textContent).toContain(messages.chooseLocation)
      expect(document.querySelector('#root')?.textContent).toContain(messages.localOnly)
      expect(document.querySelector('#root')?.textContent).not.toContain(messages.unsupportedTitle)
      expect(document.querySelector('noscript')?.textContent).toContain(messages.javascriptRequired)
      expect(html).not.toMatch(/<!--(?:page-head|app-html|page-noscript)-->/)
    },
  )

  it('lists all published pages in the sitemap', () => {
    const document = new DOMParser().parseFromString(sitemap, 'application/xml')
    expect([...document.querySelectorAll('loc')].map((node) => node.textContent)).toEqual(
      PAGE_PATHS.map((path) => `${SITE_URL}${path}`),
    )
  })
})
