// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import App from '../App'
import { deferred, ready, setupSession } from '../test/fakes'
import { loadPreferences, savePreferences } from '../recording/preferences'
import { DEFAULT_SETTINGS } from '../recording/settings'
import { en } from './en'
import { ja } from './ja'
import { initialLocale, LANGUAGE_KEY, rememberLocale } from './locale'
import { SITE_URL } from './routes'

let hydratedRoot: Root | undefined
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  document.head.innerHTML = `<title>Screen Recorder</title>
    <meta name="description" content="" />
    <link rel="canonical" href="${SITE_URL}/" />
    <meta property="og:url" content="" /><meta property="og:locale" content="" />
    <meta property="og:title" content="" /><meta property="og:description" content="" />
    <meta property="og:image:alt" content="" />
    <meta name="twitter:title" content="" /><meta name="twitter:description" content="" />
    <meta name="twitter:image:alt" content="" />
    <script type="application/ld+json">{}</script>`
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
})
afterEach(async () => {
  if (hydratedRoot) await act(async () => hydratedRoot!.unmount())
  hydratedRoot = undefined
  cleanup()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
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

describe('language routes', () => {
  it.each(['/en/', '/en', '/ja/', '/ja'])(
    'prioritizes the URL over saved and browser languages: %s',
    (path) => {
      const expected = path.startsWith('/ja') ? 'ja' : 'en'
      const other = expected === 'ja' ? 'en' : 'ja'
      rememberLocale(other)
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue([other])
      window.history.replaceState(null, '', path)
      expect(initialLocale()).toBe(expected)
      render(<App unsupported={null} />)
      expect(document.documentElement.lang).toBe(expected)
      expect(window.location.pathname).toBe(`/${expected}/`)
      // Visiting a fixed URL doesn't overwrite an explicitly saved preference.
      expect(localStorage.getItem(LANGUAGE_KEY)).toBe(other)
    },
  )

  it('keeps the automatic entry URL and English sharing preview while localizing page metadata', async () => {
    const user = userEvent.setup()
    render(<App unsupported={null} />)
    await selectLanguage(user, '日本語')
    expect(window.location.pathname).toBe('/')
    expect(document.title).toBe(ja.pageTitle)
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      ja.pageDescription,
    )
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      en.pageTitle,
    )
    expect(
      JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!),
    ).toMatchObject({ url: `${SITE_URL}/`, description: ja.appDescription })
  })

  it('switches fixed URLs, remembers the choice, and restores it at the automatic entry', async () => {
    window.history.replaceState(null, '', '/en/?source=test#recorder')
    const user = userEvent.setup()
    const view = render(<App unsupported={null} />)
    await selectLanguage(user, '日本語')
    expect(window.location.pathname).toBe('/ja/')
    expect(window.location.search).toBe('?source=test')
    expect(window.location.hash).toBe('#recorder')
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ja')
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE_URL}/ja/`,
    )
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `${SITE_URL}/ja/`,
    )
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      ja.pageTitle,
    )
    view.unmount()
    // A direct revisit uses the route; the entry point uses the remembered choice.
    rememberLocale('en')
    const revisit = render(<App unsupported={null} />)
    expect(document.documentElement.lang).toBe('ja')
    await selectLanguage(user, 'English')
    await selectLanguage(user, '日本語')
    revisit.unmount()
    window.history.replaceState(null, '', '/')
    render(<App unsupported={null} />)
    expect(document.documentElement.lang).toBe('ja')
  })

  it('preserves capture, recording, and saving through route changes and browser history', async () => {
    window.history.replaceState(null, '', '/en/')
    const { session, capture, environment, driver, sink } = setupSession()
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await selectLanguage(user, '日本語')
    expect(session.getSnapshot().phase).toBe('ready')
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    await act(async () => {
      window.history.back()
    })
    await waitFor(() => expect(window.location.pathname).toBe('/en/'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeVisible())
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE_URL}/en/`,
    )
    await act(async () => {
      window.history.forward()
    })
    await waitFor(() => expect(window.location.pathname).toBe('/ja/'))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止して保存' })).toBeVisible())
    expect(session.getSnapshot().phase).toBe('recording')
    expect(capture.release).not.toHaveBeenCalled()
    expect(driver.stop).not.toHaveBeenCalled()
    expect(environment.capture).toHaveBeenCalledOnce()
    const chunk = new Blob(['recording after navigation'])
    await act(async () => driver.data(chunk))
    const closing = deferred()
    vi.mocked(sink.close).mockReturnValueOnce(closing.promise)
    await user.click(screen.getByRole('button', { name: '停止して保存' }))
    await selectLanguage(user, 'English')
    expect(session.getSnapshot().phase).toBe('finalizing')
    await act(async () => closing.resolve())
    expect(screen.getByText('Recording saved')).toBeVisible()
    expect(driver.start).toHaveBeenCalledOnce()
    expect(sink.write).toHaveBeenCalledWith(chunk)
    expect(sink.close).toHaveBeenCalledOnce()
    expect(sink.abort).not.toHaveBeenCalled()
  })
})

it.each(['/', '/ja/'])(
  'hydrates static HTML and restores preferences without mismatches or overwriting storage: %s',
  async (path) => {
    window.history.replaceState(null, '', path)
    rememberLocale(path === '/' ? 'ja' : 'en')
    const preferences = {
      settings: { ...DEFAULT_SETTINGS, format: 'webm' as const },
      audioInputs: { pc: false, mic: false },
    }
    savePreferences(preferences)
    const pageLocale = path === '/ja/' ? 'ja' : 'en'
    const container = document.createElement('div')
    container.innerHTML = renderToString(<App pageLocale={pageLocale} unsupported={null} />)
    document.body.append(container)
    const recoverableError = vi.fn()
    await act(async () => {
      hydratedRoot = hydrateRoot(container, <App pageLocale={pageLocale} unsupported={null} />, {
        onRecoverableError: recoverableError,
      })
    })
    expect(recoverableError).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe('ja')
    expect(screen.getByText('WebM')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'マイクを録音' })).not.toBeChecked()
    expect(loadPreferences()).toEqual(preferences)
  },
)
