import { LANGUAGE_KEY } from './i18n/locale'
import { message } from './i18n/messages'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './recording/settings'
import { loadPreferences } from './recording/preferences'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { deferred, ready, setupSession } from './test/fakes'
import { RecordingError } from './recording/errors'
import type { SaveTarget } from './recording/types'

afterEach(() => cleanup())
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(LANGUAGE_KEY, 'ja')
})

// jsdom has no scrolling layout or pointer capture. Radix uses these browser
// methods while focusing and opening selects; interactions still use the real UI.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
})
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
})

async function selectSetting(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  within(screen.getByRole('dialog')).getByLabelText(label).focus()
  await user.keyboard('{ArrowDown}')
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

describe('recording UI', () => {
  it('remembers applied settings and audio switches across visits, but not the recording setup', async () => {
    const { session } = setupSession()
    const user = userEvent.setup()
    const firstVisit = render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('switch', { name: 'マイクを録音' }))
    await user.click(screen.getByRole('button', { name: '録画設定' }))
    await selectSetting(user, '動画の保存形式', 'WebM')
    await selectSetting(user, '動画の解像度', '720p')
    await user.click(screen.getByRole('button', { name: '設定を適用' }))
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    firstVisit.unmount()

    render(<App unsupported={null} />)
    expect(screen.getByRole('switch', { name: 'マイクを録音' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'PC音声を録音' })).toBeChecked()
    expect(screen.getByText('WebM')).toBeVisible()
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '録画設定' }))
    expect(screen.getByRole('combobox', { name: '動画の解像度' })).toHaveTextContent('720p')
  })

  it('applies all five recording settings without exposing codec choices', async () => {
    const { session, capture, environment } = setupSession()
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '録画設定' }))
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/H\.264|VP9|Opus|AAC/)
    await selectSetting(user, '動画の保存形式', 'WebM')
    await selectSetting(user, '動画の解像度', '720p')
    await selectSetting(user, 'フレームレート', '60 fps')
    await selectSetting(user, '動画のビットレート', '12 Mbps')
    await selectSetting(user, '音声のビットレート', '256 kbps')
    expect(session.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    expect(capture.release).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '設定を適用' }))
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      fileName: null,
      sourceLabel: null,
      settings: {
        format: 'webm',
        resolution: '720p',
        frameRate: 60,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 256_000,
      },
    })
    expect(screen.getByText('WebM')).toBeVisible()
    expect(screen.getByText('最大720p / 60fps · 12Mbps')).toBeVisible()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    expect(environment.chooseFile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(environment.chooseFile).toHaveBeenLastCalledWith('webm')
    session.dispose()
  })

  it.each([
    { label: '動画の保存形式', option: 'WebM', saved: 'MP4' },
    { label: '動画の解像度', option: '1080p', saved: '720p' },
  ])(
    'discards canceled $label changes without disturbing capture or saved settings',
    async ({ label, option, saved }) => {
      const { session, capture } = setupSession()
      const settings = { ...DEFAULT_SETTINGS, resolution: '720p' as const }
      session.setRecordingSettings(settings)
      await ready(session)
      const user = userEvent.setup()
      render(<App session={session} unsupported={null} />)
      await user.click(screen.getByRole('button', { name: '録画設定' }))
      await selectSetting(user, label, option)
      await user.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(session.getSnapshot().settings).toEqual(settings)
      expect(loadPreferences().settings).toEqual(settings)
      expect(screen.getByRole('button', { name: '録画開始' })).toBeEnabled()
      expect(capture.release).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: '録画設定' }))
      expect(screen.getByRole('combobox', { name: label })).toHaveTextContent(saved)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('disables unused audio bitrate and restores defaults only when applied', async () => {
    const { session } = setupSession()
    session.setAudioEnabled('pc', false)
    session.setAudioEnabled('mic', false)
    const settings = { ...DEFAULT_SETTINGS, format: 'webm' as const, frameRate: 60 }
    session.setRecordingSettings(settings)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '録画設定' }))
    expect(screen.getByRole('combobox', { name: '音声のビットレート' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '初期値に戻す' }))
    expect(session.getSnapshot().settings).toEqual(settings)
    expect(loadPreferences().settings).toEqual(settings)
    await user.click(screen.getByRole('button', { name: '設定を適用' }))
    expect(session.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    expect(loadPreferences().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('lets users select video only, resets capture readiness, and keeps switches locked while recording', async () => {
    const { session, environment, sink } = setupSession()
    const closing = deferred()
    vi.mocked(sink.close).mockReturnValueOnce(closing.promise)
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    const pc = screen.getByRole('switch', { name: 'PC音声を録音' })
    const mic = screen.getByRole('switch', { name: 'マイクを録音' })
    expect(pc).toBeChecked()
    expect(mic).toBeChecked()
    await user.click(mic)
    expect(mic).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '使用するマイク' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    await user.click(pc)
    expect(pc).not.toBeChecked()
    expect(screen.getByText('画面のみ録画します。音声の共有・マイク許可は不要です。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    expect(environment.capture).toHaveBeenLastCalledWith(
      { pc: false, mic: false },
      DEFAULT_SETTINGS,
    )
    expect(screen.getByRole('meter', { name: 'PC音声の入力レベル' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.getByRole('meter', { name: 'マイクの入力レベル' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(screen.getByRole('button', { name: '録画設定' })).toBeDisabled()
    expect(pc).toBeDisabled()
    expect(mic).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '停止して保存' }))
    expect(screen.getByRole('button', { name: '録画設定' })).toBeDisabled()
    expect(pc).toBeDisabled()
    expect(mic).toBeDisabled()
    await act(async () => closing.resolve())
    await user.click(screen.getByRole('button', { name: '新しい録画' }))
    expect(pc).toBeEnabled()
    expect(mic).toBeEnabled()
    expect(pc).not.toBeChecked()
    expect(mic).not.toBeChecked()
  })

  it('guides keyboard users through capture and recording in two steps', async () => {
    const { session, driver } = setupSession()
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    const steps = within(screen.getByRole('list', { name: '録画の操作手順' }))
    expect(steps.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '画面・音声を準備',
      '録画開始',
    ])
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '使用するマイク' })).toBeDisabled()
    expect(steps.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '録画開始' })).toHaveAccessibleDescription(
      /保存先を選ぶと録画が始まります/,
    )
    steps.getByRole('switch', { name: 'PC音声を録音' }).focus()
    expect(steps.getByRole('switch', { name: 'PC音声を録音' })).toHaveFocus()
    await user.tab()
    expect(steps.getByRole('switch', { name: 'マイクを録音' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(screen.getByRole('button', { name: '録画開始' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('録画できます')
    expect(driver.start).not.toHaveBeenCalled()
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(steps.getByRole('combobox', { name: '使用するマイク' })).toHaveFocus()
  })

  it('keeps capture ready when the file picker is canceled and automatically records after retry', async () => {
    const { session, environment, capture, driver } = setupSession()
    vi.mocked(environment.chooseFile).mockRejectedValueOnce(
      Object.assign(new Error('Canceled'), { name: 'AbortError' }),
    )
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    expect(environment.chooseFile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('録画できます')
    expect(screen.getByRole('button', { name: '画面・音声を選び直す' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '使用するマイク' })).toHaveTextContent(
      'テストマイク',
    )
    expect(screen.getByRole('button', { name: '録画開始' })).toBeEnabled()
    expect(capture.release).not.toHaveBeenCalled()
    expect(driver.start).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(screen.getByRole('button', { name: '停止して保存' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('録画中')
    expect(screen.getByText('meeting-test.mp4')).toBeVisible()
    expect(environment.capture).toHaveBeenCalledOnce()
    expect(environment.chooseFile).toHaveBeenCalledTimes(2)
    expect(driver.start).toHaveBeenCalledOnce()
  })

  it('shows a pending start and locks configuration until the save location is chosen', async () => {
    const { session, environment, target, driver } = setupSession()
    const picking = deferred<SaveTarget>()
    vi.mocked(environment.chooseFile).mockReturnValueOnce(picking.promise)
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(screen.getByRole('status')).toHaveTextContent('開始を準備しています')
    expect(screen.getByRole('button', { name: '開始を準備中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '画面・音声を選び直す' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '録画設定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'マイクを録音' })).toBeDisabled()
    expect(screen.getByLabelText('録画時間')).toHaveTextContent('00:00:00')
    expect(driver.start).not.toHaveBeenCalled()
    await act(async () => picking.resolve(target))
    expect(screen.getByRole('status')).toHaveTextContent('録画中')
    expect(screen.getByRole('button', { name: '停止して保存' })).toBeEnabled()
    expect(driver.start).toHaveBeenCalledOnce()
  })

  it('returns to capture preparation if sharing ends before recording, and can recover', async () => {
    const { session, capture } = setupSession()
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    act(() => capture.ended?.(message('interruptedScreen')))
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    expect(screen.getByRole('button', { name: '録画開始' })).toBeEnabled()
  })

  it('locks configuration while recording and shows saving until the file is committed', async () => {
    const { session, sink } = setupSession()
    const closing = deferred()
    vi.mocked(sink.close).mockReturnValueOnce(closing.promise)
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(screen.getByRole('button', { name: '画面・音声を選び直す' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: /使用するマイク/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '停止して保存' }))
    expect(screen.getByRole('status')).toHaveTextContent('保存中')
    expect(screen.queryByText('録画を保存しました')).not.toBeInTheDocument()
    await act(async () => {
      closing.resolve()
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存完了'))
    await user.click(screen.getByRole('button', { name: '新しい録画' }))
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
  })

  it('shows missing PC audio and allows the capture step to be retried', async () => {
    const { session, environment } = setupSession()
    vi.mocked(environment.capture).mockRejectedValueOnce(
      new RecordingError(message('errorPcMissing')),
    )
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    expect(screen.getByRole('alert')).toHaveTextContent('PC音声が取得できていません')
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '画面・音声を準備' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeEnabled()
  })

  it('never reports saved when closing the file fails', async () => {
    const { session, sink } = setupSession()
    vi.mocked(sink.close).mockRejectedValueOnce(new Error('Disk full'))
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    await user.click(screen.getByRole('button', { name: '停止して保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('保存は完了していません')
    expect(screen.queryByText('録画を保存しました')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeEnabled()
  })

  it('disables acquisition on unsupported browsers', () => {
    render(
      <App
        session={setupSession().session}
        unsupported={message('errorFormatUnsupported', { format: 'MP4' })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('MP4で録画できません')
    expect(screen.getByRole('button', { name: '画面・音声を準備' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '録画開始' })).toBeDisabled()
  })

  it('opens help with the keyboard and exposes textual recording guidance', async () => {
    const user = userEvent.setup()
    render(<App session={setupSession().session} unsupported={null} />)
    await user.tab()
    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '使い方' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveTextContent('停止して保存')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('warns on page exit during recording and saving, then removes the warning', async () => {
    const { session, sink } = setupSession()
    const close = deferred()
    vi.mocked(sink.close).mockReturnValueOnce(close.promise)
    await ready(session)
    const user = userEvent.setup()
    render(<App session={session} unsupported={null} />)
    const mayLeave = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    expect(mayLeave()).toBe(true)
    await user.click(screen.getByRole('button', { name: '録画開始' }))
    expect(mayLeave()).toBe(false)
    await user.click(screen.getByRole('button', { name: '停止して保存' }))
    expect(mayLeave()).toBe(false)
    await act(async () => {
      close.resolve()
    })
    expect(mayLeave()).toBe(true)
  })
})
