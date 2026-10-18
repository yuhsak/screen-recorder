import { ja, type MessageKey } from './ja'
import { en } from './en'

export type Locale = 'ja' | 'en'
export type { MessageKey }
export type MessageParams = Readonly<Record<string, string | number>>
export interface Message {
  readonly key: MessageKey
  readonly params?: MessageParams
}

// Store the reason, not the rendered text, so existing messages switch language too.
export function message(key: MessageKey, params?: MessageParams): Message {
  return params ? { key, params } : { key }
}

export function translate(
  locale: Locale,
  value: MessageKey | Message,
  params?: MessageParams,
): string {
  const descriptor = typeof value === 'string' ? message(value, params) : value
  const template = (locale === 'ja' ? ja : en)[descriptor.key]
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    String(descriptor.params?.[name] ?? placeholder),
  )
}
