// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { deferred, ready, setupSession } from '../test/fakes'
import { DEFAULT_SETTINGS } from '../recording/settings'
import { loadPreferences, savePreferences } from '../recording/preferences'
import { initialLocale, LANGUAGE_KEY, rememberLocale } from './locale'
import { message, translate } from './messages'
import { ja, type MessageKey } from './ja'
import { en } from './en'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
})

async function selectLanguage(user: ReturnType<typeof userEvent.setup>, name: string) {
  screen.getByRole('combobox', { name: /^(Language|表示言語)$/ }).focus()
  await user.keyboard('{ArrowDown}')
  await user.click(screen.getByRole('option', { name }))
}

describe('language selection', () => {
  it.each([
    { languages: ['ja-JP'], language: 'ja-JP', expected: 'ja' },
    { languages: ['ja'], language: 'ja', expected: 'ja' },
    { languages: ['JA-jp'], language: 'JA-jp', expected: 'ja' },
    { languages: ['en-US', 'ja-JP'], language: 'en-US', expected: 'en' },
    { languages: ['fr-FR'], language: 'fr-FR', expected: 'en' },
    { languages: [], language: 'ja-JP', expected: 'ja' },
    { languages: [], language: '', expected: 'en' },
  ])(
    'uses the preferred browser language: $languages / $language',
    ({ languages, language, expected }) => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
      expect(initialLocale()).toBe(expected)
    },
  )

  it('prioritizes a valid saved choice and ignores invalid values', () => {
    rememberLocale('ja')
    expect(initialLocale()).toBe('ja')
    localStorage.setItem(LANGUAGE_KEY, 'unsupported')
    expect(initialLocale()).toBe('en')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
    rememberLocale('en')
    expect(initialLocale()).toBe('en')
  })

  it('remembers the selected language across visits without changing the URL or recording preferences', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
    const preferences = {
      settings: { ...DEFAULT_SETTINGS, format: 'webm' as const },
      audioInputs: { pc: true, mic: false },
    }
    savePreferences(preferences)
    const url = window.location.href
    const user = userEvent.setup()
    const firstVisit = render(<App unsupported={null} />)
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeVisible()
    await selectLanguage(user, 'English')
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe(en.pageTitle)
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en')
    expect(loadPreferences()).toEqual(preferences)
    firstVisit.unmount()
    render(<App unsupported={null} />)
    expect(screen.getByRole('button', { name: 'Set up screen & audio' })).toBeVisible()
    expect(screen.getByText('WebM')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Record Microphone' })).not.toBeChecked()
    expect(window.location.href).toBe(url)
    await selectLanguage(user, '日本語')
    expect(document.documentElement.lang).toBe('ja')
    expect(document.title).toBe(ja.pageTitle)
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ja')
  })

  it('still starts and switches language when browser storage is blocked', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const user = userEvent.setup()
    render(<App unsupported={null} />)
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeVisible()
    await selectLanguage(user, 'English')
    expect(screen.getByRole('button', { name: 'Set up screen & audio' })).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
  })

  it('keeps switching available when the language cannot be saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    expect(() => rememberLocale('ja')).not.toThrow()
  })
})

describe('localized recording UI', () => {
  it('translates settings, estimates, and accessible dialog controls', async () => {
    const user = userEvent.setup()
    render(<App session={setupSession().session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: 'Recording settings' }))
    expect(screen.getByRole('combobox', { name: 'Video format' })).toHaveTextContent('MP4')
    expect(screen.getByRole('combobox', { name: 'Audio bitrate' })).toHaveTextContent('192 kbps')
    expect(
      screen.getByLabelText('Estimated file size for one hour of recording'),
    ).toHaveTextContent('About 3.69 GB')
    expect(screen.getByRole('dialog').textContent).not.toMatch(
      /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Stop and save')
    await user.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('retranslates existing permission errors and unsupported-format details', async () => {
    const { session, environment } = setupSession()
    vi.mocked(environment.chooseFile).mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError'),
    )
    const user = userEvent.setup()
    await ready(session)
    const view = render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(screen.getByRole('alert')).toHaveTextContent(en.errorPermission)
    await selectLanguage(user, '日本語')
    expect(screen.getByRole('alert')).toHaveTextContent(ja.errorPermission)
    expect(environment.chooseFile).toHaveBeenCalledOnce()
    view.unmount()
    render(
      <App
        session={setupSession().session}
        unsupported={message('errorSilentFormatUnsupported', { format: 'WebM' })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('WebM（音声なし）')
    await selectLanguage(user, 'English')
    expect(screen.getByRole('alert')).toHaveTextContent('cannot record WebM without audio')
  })

  it('preserves prepared devices and an active recording through language changes and saving', async () => {
    const { session, capture, environment, driver, sink } = setupSession()
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    const prepared = session.getSnapshot()
    await selectLanguage(user, '日本語')
    expect(session.getSnapshot()).toBe(prepared)
    expect(capture.release).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    const active = session.getSnapshot()
    await selectLanguage(user, 'English')
    expect(session.getSnapshot().phase).toBe('recording')
    expect(session.getSnapshot().fileName).toBe(active.fileName)
    expect(screen.getByRole('status')).toHaveTextContent('Recording')
    expect(driver.start).toHaveBeenCalledOnce()
    expect(driver.stop).not.toHaveBeenCalled()
    expect(capture.release).not.toHaveBeenCalled()
    expect(environment.capture).toHaveBeenCalledOnce()
    expect(environment.chooseFile).toHaveBeenCalledOnce()
    const chunk = new Blob(['recording continues'])
    await act(async () => driver.data(chunk))
    const closing = deferred()
    vi.mocked(sink.close).mockReturnValueOnce(closing.promise)
    await user.click(screen.getByRole('button', { name: 'Stop and save' }))
    await selectLanguage(user, '日本語')
    expect(session.getSnapshot().phase).toBe('finalizing')
    expect(screen.getByRole('status')).toHaveTextContent('保存中')
    await act(async () => closing.resolve())
    expect(screen.getByText('録画を保存しました')).toBeVisible()
    expect(sink.write).toHaveBeenCalledWith(chunk)
    expect(sink.close).toHaveBeenCalledOnce()
    expect(sink.abort).not.toHaveBeenCalled()
  })

  it('translates interruption reasons after capture ends', async () => {
    const { session, capture } = setupSession()
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    await act(async () => {
      capture.ended?.(message('interruptedMicrophone'))
      await session.stop()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(en.interruptedMicrophone)
    await selectLanguage(user, '日本語')
    expect(screen.getByRole('alert')).toHaveTextContent(ja.interruptedMicrophone)
    expect(screen.getByRole('alert')).toHaveTextContent('MP4の保存は完了しています。')
  })
})

it('provides the same interpolation fields in both complete dictionaries', () => {
  const fields = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort())
  for (const key of Object.keys(ja) as MessageKey[]) {
    expect(fields(en[key]), key).toEqual(fields(ja[key]))
    expect(en[key].trim(), key).not.toBe('')
    expect(translate('en', message(key))).toBe(en[key])
  }
})
