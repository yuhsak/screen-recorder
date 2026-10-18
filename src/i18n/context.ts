import { createContext, useContext } from 'react'
import type { Locale, Message, MessageKey, MessageParams } from './messages'

interface I18n {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (value: MessageKey | Message, params?: MessageParams) => string
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const context = useContext(I18nContext)
  if (!context) throw new Error('I18nProvider is required')
  return context
}
