import type { Locale } from './messages'

export const SITE_URL = 'https://screen-recorder.ysk.im'
export const PAGE_PATHS = ['/', '/en/', '/ja/'] as const
export type PagePath = (typeof PAGE_PATHS)[number]

export function pathLocale(pathname: string): Locale | null {
  if (/^\/en\/?$/.test(pathname)) return 'en'
  if (/^\/ja\/?$/.test(pathname)) return 'ja'
  return null
}

export function pagePath(pathname: string): PagePath {
  const locale = pathLocale(pathname)
  return locale ? `/${locale}/` : '/'
}
