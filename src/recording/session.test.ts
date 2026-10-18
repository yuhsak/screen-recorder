import { message } from '../i18n/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import { RecordingError } from './errors'
import { PENDING_LIMIT } from './file-writer'
import { deferred, FakeCapture, flush, ready, setupSession } from '../test/fakes'
import type { Capture, FileSink } from './types'

afterEach(() => vi.useRealTimers())

describe('RecordingSession', () => {
  it('applies bitrate changes at recording start without releasing the prepared capture or file', async () => {
    const { session, capture, environment } = setupSession()
    await ready(session)
    const settings = {
      ...DEFAULT_SETTINGS,
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 256_000,
    }
    session.setRecordingSettings(settings)
    expect(session.getSnapshot().phase).toBe('ready')
    expect(capture.release).not.toHaveBeenCalled()
    await session.start()
    expect(capture.createRecorder).toHaveBeenCalledWith(settings)
    expect(environment.capture).toHaveBeenCalledOnce()
    await session.stop()
    session.reset()
    expect(session.getSnapshot().settings).toEqual(settings)
  })

  it.each([{ resolution: '720p' } as const, { frameRate: 60 }])(
    'requires fresh capture for changed capture settings: %j',
    async (change) => {
      const { session, capture, environment } = setupSession()
      await ready(session)
      const oldEnded = capture.ended!
      const settings = { ...DEFAULT_SETTINGS, ...change }
      session.setRecordingSettings(settings)
      expect(session.getSnapshot()).toMatchObject({
        phase: 'idle',
        fileName: 'meeting-test.mp4',
        sourceLabel: null,
        microphones: [],
      })
      expect(capture.release).toHaveBeenCalledOnce()
      await session.prepareCapture()
      expect(environment.capture).toHaveBeenLastCalledWith({ pc: true, mic: true }, settings)
      oldEnded(message('interruptedScreen'))
      expect(session.getSnapshot().phase).toBe('ready')
      session.dispose()
    },
  )

  it('requires a new save target after a format change and uses the new format with an existing capture', async () => {
    const { session, capture, environment, target } = setupSession()
    await ready(session)
    const settings = { ...DEFAULT_SETTINGS, format: 'webm' as const }
    session.setRecordingSettings(settings)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      fileName: null,
      sourceLabel: 'テスト会議',
    })
    expect(capture.release).not.toHaveBeenCalled()
    await session.start()
    expect(target.open).not.toHaveBeenCalled()
    vi.mocked(environment.chooseFile).mockResolvedValueOnce({ ...target, name: 'meeting.webm' })
    await session.chooseFile()
    expect(environment.chooseFile).toHaveBeenLastCalledWith('webm')
    expect(session.getSnapshot().phase).toBe('ready')
    await session.start()
    expect(capture.createRecorder).toHaveBeenCalledWith(settings)
    await session.stop()
  })

  it('releases the old capture after audio selection changes and keeps the save target', async () => {
    const { session, capture, environment, target } = setupSession()
    await ready(session)
    const oldEnded = capture.ended!
    session.setAudioEnabled('mic', false)
    expect(capture.release).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      fileName: target.name,
      preview: null,
      sourceLabel: null,
      microphones: [],
      selectedMicrophone: '',
      audioInputs: { pc: true, mic: false },
    })
    await session.start()
    expect(target.open).not.toHaveBeenCalled()
    await session.prepareCapture()
    expect(environment.capture).toHaveBeenLastCalledWith({ pc: true, mic: false }, DEFAULT_SETTINGS)
    oldEnded(message('interruptedMicrophone'))
    expect(session.getSnapshot().phase).toBe('ready')
    await session.selectMicrophone('ignored')
    expect(capture.replaceMicrophone).not.toHaveBeenCalled()
    session.dispose()
  })

  it('records without audio and retains that preference for the next recording', async () => {
    const { session, environment, sink } = setupSession()
    session.setAudioEnabled('pc', false)
    session.setAudioEnabled('mic', false)
    await ready(session)
    expect(environment.capture).toHaveBeenCalledWith({ pc: false, mic: false }, DEFAULT_SETTINGS)
    await session.start()
    await session.stop()
    expect(sink.close).toHaveBeenCalledOnce()
    session.reset()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      audioInputs: { pc: false, mic: false },
    })
  })

  it('locks audio selection during preparation, recording and saving', async () => {
    const { session, environment, capture, sink } = setupSession()
    const captureGate = deferred<Capture>()
    const closeGate = deferred()
    vi.mocked(environment.capture).mockReturnValueOnce(captureGate.promise)
    vi.mocked(sink.close).mockReturnValueOnce(closeGate.promise)
    await session.chooseFile()
    const preparing = session.prepareCapture()
    session.setRecordingSettings({ ...DEFAULT_SETTINGS, frameRate: 60 })
    expect(session.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    session.setAudioEnabled('mic', false)
    expect(session.getSnapshot().audioInputs.mic).toBe(true)
    captureGate.resolve(capture)
    await preparing
    await session.start()
    session.setRecordingSettings({ ...DEFAULT_SETTINGS, format: 'webm' })
    expect(session.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    session.setAudioEnabled('pc', false)
    expect(session.getSnapshot().audioInputs.pc).toBe(true)
    const stopping = session.stop()
    session.setRecordingSettings({ ...DEFAULT_SETTINGS, videoBitsPerSecond: 12_000_000 })
    expect(session.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    session.setAudioEnabled('mic', false)
    expect(session.getSnapshot().audioInputs.mic).toBe(true)
    closeGate.resolve()
    await stopping
  })

  it('does not commit an empty file if the encoder produces no data', async () => {
    const { session, driver, sink } = setupSession()
    driver.finalChunk = null
    await ready(session)
    await session.start()
    await session.stop()
    expect(session.getSnapshot().phase).toBe('error')
    expect(session.getSnapshot().message).toEqual(message('errorNoData'))
    expect(sink.close).not.toHaveBeenCalled()
    expect(sink.abort).toHaveBeenCalledOnce()
  })
  it('requires both file and capture, and prevents duplicate starts', async () => {
    const { session, target, driver } = setupSession()
    await session.start()
    expect(target.open).not.toHaveBeenCalled()
    await session.chooseFile()
    expect(session.getSnapshot().phase).toBe('idle')
    await session.prepareCapture()
    expect(session.getSnapshot().phase).toBe('ready')
    await Promise.all([session.start(), session.start()])
    expect(target.open).toHaveBeenCalledOnce()
    expect(driver.start).toHaveBeenCalledOnce()
    await session.stop()
  })

  it('waits for the final data event, pending writes and close before reporting completion', async () => {
    const { session, driver, sink } = setupSession()
    const write = deferred()
    const close = deferred()
    vi.mocked(sink.write).mockImplementationOnce(() => write.promise)
    vi.mocked(sink.close).mockImplementationOnce(() => close.promise)
    await ready(session)
    await session.start()
    driver.data(new Blob(['first']))
    driver.finalChunk = new Blob(['last'])
    const stopped = session.stop()
    await flush()
    expect(session.getSnapshot().phase).toBe('finalizing')
    expect(sink.close).not.toHaveBeenCalled()
    write.resolve()
    await flush()
    expect(sink.write).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().phase).toBe('finalizing')
    close.resolve()
    await stopped
    expect(session.getSnapshot()).toMatchObject({
      phase: 'completed',
      writtenBytes: 9,
      pendingBytes: 0,
    })
  })

  it('combines stop-button and capture-ended events into a single finalization', async () => {
    const { session, capture, driver, sink } = setupSession()
    await ready(session)
    await session.start()
    capture.ended?.(message('interruptedMicrophone'))
    await Promise.all([session.stop(), session.stop()])
    expect(driver.stop).toHaveBeenCalledOnce()
    expect(sink.close).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'completed',
      interruption: message('interruptedMicrophone'),
    })
    expect(capture.release).toHaveBeenCalledOnce()
  })

  it('handles an unsolicited recorder stop after its final data', async () => {
    const { session, driver, sink } = setupSession()
    await ready(session)
    await session.start()
    driver.finalChunk = new Blob(['tail'])
    driver.finish()
    await session.stop()
    expect(session.getSnapshot().phase).toBe('completed')
    expect(sink.write).toHaveBeenCalledOnce()
    expect(driver.stop).not.toHaveBeenCalled()
  })

  it('stops on queue overflow and preserves the last chunk', async () => {
    const { session, driver, sink } = setupSession()
    const gate = deferred()
    vi.mocked(sink.write).mockImplementationOnce(() => gate.promise)
    await ready(session)
    await session.start()
    // A sparse test double avoids allocating a 64MiB buffer; the sink is fake.
    driver.data({ size: PENDING_LIMIT } as Blob)
    driver.finalChunk = new Blob(['last'])
    await flush()
    expect(session.getSnapshot().phase).toBe('finalizing')
    gate.resolve()
    await session.stop()
    expect(sink.write).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'completed',
      writtenBytes: PENDING_LIMIT + 4,
    })
  })

  it.each(['write', 'close'] as const)('does not report success when %s fails', async (method) => {
    const { session, driver, sink, capture } = setupSession()
    vi.mocked(sink[method]).mockRejectedValue(new Error('disk failure'))
    await ready(session)
    await session.start()
    driver.data(new Blob(['data']))
    await session.stop()
    await flush()
    expect(session.getSnapshot().phase).toBe('error')
    expect(session.getSnapshot().message).toEqual(message('errorUnknown'))
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(capture.release).toHaveBeenCalledOnce()
  })

  it('lets the user retry a cancelled picker without losing the existing selection', async () => {
    const { session, environment } = setupSession()
    await ready(session)
    vi.mocked(environment.chooseFile).mockRejectedValueOnce(
      new DOMException('cancel', 'AbortError'),
    )
    await session.chooseFile()
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', fileName: 'meeting-test.mp4' })
    await session.chooseFile()
    expect(session.getSnapshot().message).toBeNull()
    session.dispose()
  })

  it('blocks recording after capture fails or the audio track is missing', async () => {
    const { session, environment, driver } = setupSession()
    await session.chooseFile()
    vi.mocked(environment.capture).mockRejectedValueOnce(
      new RecordingError(message('errorPcMissing')),
    )
    await session.prepareCapture()
    await session.start()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      message: message('errorPcMissing'),
    })
    expect(driver.start).not.toHaveBeenCalled()
  })

  it('aborts the sink if a required track ends while the file is being opened', async () => {
    const { session, target, sink, capture, driver } = setupSession()
    const opening = deferred<FileSink>()
    vi.mocked(target.open).mockReturnValueOnce(opening.promise)
    await ready(session)
    const starting = session.start()
    capture.ended?.(message('interruptedScreen'))
    opening.resolve(sink)
    await starting
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(driver.start).not.toHaveBeenCalled()
    expect(session.getSnapshot().phase).toBe('idle')
  })

  it('releases a late permission result after unmount', async () => {
    const { session, environment, capture } = setupSession()
    const pending = deferred<Capture>()
    vi.mocked(environment.capture).mockReturnValueOnce(pending.promise)
    const preparing = session.prepareCapture()
    session.dispose()
    pending.resolve(capture)
    await preparing
    expect(capture.release).toHaveBeenCalledOnce()
    expect(session.getSnapshot().preview).toBeNull()
  })

  it('cleans up and aborts if MediaRecorder fails to start', async () => {
    const { session, driver, sink, capture } = setupSession()
    driver.start.mockImplementationOnce(() => {
      throw new Error('Encoder unavailable')
    })
    await ready(session)
    await session.start()
    expect(session.getSnapshot().phase).toBe('error')
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(capture.release).toHaveBeenCalledOnce()
  })

  it('starts a new recording without reusing the previous file or callbacks', async () => {
    const { session, environment, capture } = setupSession()
    await ready(session)
    await session.start()
    await session.stop()
    session.reset()
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', fileName: null, writtenBytes: 0 })
    const second = new FakeCapture()
    vi.mocked(environment.capture).mockResolvedValueOnce(second)
    await ready(session)
    await session.start()
    await session.stop()
    expect(capture.driver.events).toBeNull()
    expect(second.release).toHaveBeenCalledOnce()
  })

  it('uses elapsed clock time rather than counting interval callbacks', async () => {
    vi.useFakeTimers()
    const { session, environment } = setupSession()
    await ready(session)
    await session.start()
    vi.mocked(environment.now).mockReturnValue(101000)
    await vi.advanceTimersByTimeAsync(250)
    expect(session.getSnapshot().elapsedMs).toBe(100000)
    await session.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores queued callbacks from a previous recording', async () => {
    const { session, environment, driver } = setupSession()
    await ready(session)
    await session.start()
    const oldEvents = driver.events
    await session.stop()
    session.reset()
    const next = new FakeCapture()
    next.driver.autoStop = false
    vi.mocked(environment.capture).mockResolvedValueOnce(next)
    await ready(session)
    await session.start()
    const stopping = session.stop()
    oldEvents?.data(new Blob(['stale']))
    oldEvents?.stop()
    await flush()
    expect(session.getSnapshot()).toMatchObject({ phase: 'finalizing', writtenBytes: 0 })
    next.driver.finish()
    await stopping
    expect(session.getSnapshot().phase).toBe('completed')
  })
})
