import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext } from './context'
import { initialLocale, rememberLocale } from './locale'
import { pagePath, pathLocale } from './routes'
import { updatePageMetadata } from './metadata'
import { useHydrated } from '../lib/use-hydrated'
import {
  translate,
  type Locale,
  type Message,
  type MessageKey,
  type MessageParams,
} from './messages'

export function I18nProvider({
  children,
  pageLocale = 'en',
}: {
  children: ReactNode
  pageLocale?: Locale
}) {
  const hydrated = useHydrated()
  const [selection, updateSelection] = useState(() => ({ locale: initialLocale(), path: '/' }))
  const locale = hydrated ? selection.locale : pageLocale
  const setLocale = useCallback((next: Locale) => {
    const path = pagePath(window.location.pathname)
    const nextPath = path === '/' ? '/' : `/${next}/`
    if (path !== nextPath) {
      window.history.pushState(
        null,
        '',
        `${nextPath}${window.location.search}${window.location.hash}`,
      )
    }
    updateSelection({ locale: next, path: nextPath })
    rememberLocale(next)
  }, [])

  useEffect(() => {
    const onPopState = () =>
      updateSelection({ locale: initialLocale(), path: pagePath(window.location.pathname) })
    window.addEventListener('popstate', onPopState)
    // Normalize /en and /ja without reloading or creating another history entry.
    const fixed = pathLocale(window.location.pathname)
    if (fixed && window.location.pathname !== `/${fixed}/`) {
      window.history.replaceState(
        window.history.state,
        '',
        `/${fixed}/${window.location.search}${window.location.hash}`,
      )
    }
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (text: MessageKey | Message, params?: MessageParams) => translate(locale, text, params),
    }),
    [locale, setLocale],
  )

  useEffect(() => {
    if (hydrated) updatePageMetadata(pagePath(window.location.pathname), locale)
  }, [locale, selection.path, hydrated])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
