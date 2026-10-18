import type { Locale } from './messages'
import { pathLocale } from './routes'

export const LANGUAGE_KEY = 'screen-recorder.language'

export function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const fixed = pathLocale(window.location.pathname)
  if (fixed) return fixed
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY)
    if (saved === 'ja' || saved === 'en') return saved
  } catch {
    // Language selection still works when storage is blocked.
  }
  const preferred = navigator.languages?.[0] || navigator.language || ''
  return /^ja(?:-|$)/i.test(preferred) ? 'ja' : 'en'
}

export function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, locale)
  } catch {
    // Keep the in-memory selection even when storage is unavailable or full.
  }
}
