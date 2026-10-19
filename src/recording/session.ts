import { message, type Message } from '../i18n/messages'
import { describeError, RecordingError } from './errors'
import { FileWriter } from './file-writer'
import {
  DEFAULT_SETTINGS,
  captureSettingsChanged,
  sameSettings,
  type RecordingSettings,
} from './settings'
import type {
  AudioInputs,
  Capture,
  FileSink,
  RecorderDriver,
  RecordingEnvironment,
  Snapshot,
} from './types'

const initialSnapshot = (): Snapshot => ({
  phase: 'idle',
  fileName: null,
  sourceLabel: null,
  preview: null,
  microphones: [],
  selectedMicrophone: '',
  audioInputs: { pc: true, mic: true },
  settings: DEFAULT_SETTINGS,
  elapsedMs: 0,
  writtenBytes: 0,
  pendingBytes: 0,
  message: null,
  interruption: null,
})

export class RecordingSession {
  private snapshot = initialSnapshot()
  private listeners = new Set<() => void>()
  private capture: Capture | null = null
  private driver: RecorderDriver | null = null
  private writer: FileWriter | null = null
  private unlistenRecorder: (() => void) | null = null
  private unlistenCapture: (() => void) | null = null
  private resolveStopped: (() => void) | null = null
  private stopped: Promise<void> = Promise.resolve()
  private stopping: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0
  private generation = 0

  constructor(
    private readonly environment: RecordingEnvironment,
    preferences?: Pick<Snapshot, 'settings' | 'audioInputs'>,
  ) {
    if (preferences) {
      this.snapshot.settings = { ...preferences.settings }
      this.snapshot.audioInputs = { ...preferences.audioInputs }
    }
  }

  getSnapshot = (): Snapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  levels = (): { pc: number; mic: number } => this.capture?.levels() ?? { pc: 0, mic: 0 }

  setRecordingSettings(settings: RecordingSettings): void {
    if (!this.canPrepare() || sameSettings(this.snapshot.settings, settings)) return
    const patch: Partial<Snapshot> = { settings: { ...settings }, message: null }
    if (captureSettingsChanged(this.snapshot.settings, settings)) {
      this.generation++
      this.releaseCapture()
      Object.assign(patch, {
        preview: null,
        sourceLabel: null,
        microphones: [],
        selectedMicrophone: '',
      })
    }
    patch.phase = this.capture ? 'ready' : 'idle'
    this.update(patch)
  }

  setAudioEnabled(input: keyof AudioInputs, enabled: boolean): void {
    if (!this.canPrepare() || this.snapshot.audioInputs[input] === enabled) return
    // A new selection needs fresh permissions and tracks. Never reuse a capture
    // whose contents differ from the switches shown to the user.
    this.generation++
    this.releaseCapture()
    this.update({
      audioInputs: { ...this.snapshot.audioInputs, [input]: enabled },
      phase: 'idle',
      preview: null,
      sourceLabel: null,
      microphones: [],
      selectedMicrophone: '',
      message: null,
    })
  }

  async prepareCapture(): Promise<void> {
    if (!this.canPrepare()) return
    this.releaseCapture()
    const generation = this.generation
    this.update({
      phase: 'preparing',
      preview: null,
      sourceLabel: null,
      microphones: [],
      message: null,
    })
    try {
      const capture = await this.environment.capture(
        this.snapshot.audioInputs,
        this.snapshot.settings,
      )
      if (generation !== this.generation) {
        capture.release()
        return
      }
      this.capture = capture
      this.unlistenCapture = capture.onEnded((reason) => {
        if (generation !== this.generation) return
        if (this.snapshot.phase === 'recording' || this.snapshot.phase === 'finalizing') {
          void this.stop(reason)
        } else {
          this.generation++
          this.releaseCapture()
          this.update({
            phase: 'idle',
            preview: null,
            sourceLabel: null,
            microphones: [],
            message: reason,
          })
        }
      })
      this.update({
        preview: capture.preview,
        sourceLabel: capture.sourceLabel,
        microphones: capture.microphones,
        selectedMicrophone: capture.selectedMicrophone,
      })
      this.preparationDone()
    } catch (error) {
      if (generation !== this.generation) return
      this.preparationDone(describeError(error))
    }
  }

  async selectMicrophone(deviceId: string): Promise<void> {
    if (!this.canPrepare() || !this.capture || !this.snapshot.audioInputs.mic) return
    const generation = this.generation
    const capture = this.capture
    this.update({ phase: 'preparing', message: null })
    try {
      await capture.replaceMicrophone(deviceId)
      if (generation !== this.generation) return
      this.update({
        selectedMicrophone: capture.selectedMicrophone,
        microphones: capture.microphones,
      })
      this.preparationDone()
    } catch (error) {
      if (generation === this.generation) this.preparationDone(describeError(error))
    }
  }

  async start(): Promise<void> {
    if (this.snapshot.phase !== 'ready' || !this.capture) return
    const generation = this.generation
    const capture = this.capture
    this.update({
      phase: 'starting',
      fileName: null,
      message: null,
      interruption: null,
      elapsedMs: 0,
      writtenBytes: 0,
      pendingBytes: 0,
    })
    let sink: FileSink
    let picked = false
    try {
      // Open the picker directly from the click, before any unrelated await.
      const target = await this.environment.chooseFile(this.snapshot.settings.format)
      if (generation !== this.generation) return
      picked = true
      sink = await target.open()
      if (generation !== this.generation) {
        await sink.abort().catch(() => undefined)
        return
      }
      this.update({ fileName: target.name })
    } catch (error) {
      if (generation !== this.generation) return
      const reason = describeError(error)
      // Canceling the picker is a normal return to the prepared preview. Other
      // file errors also allow retrying without acquiring the screen again.
      this.preparationDone(!picked && reason.key === 'errorCanceled' ? null : reason)
      return
    }
    try {
      this.writer = new FileWriter(sink, {
        progress: (writtenBytes, pendingBytes) => {
          if (generation === this.generation) this.update({ writtenBytes, pendingBytes })
        },
        limit: () => {
          if (generation === this.generation) void this.stop(message('interruptedSlowDisk'))
        },
        error: (error) => {
          if (generation === this.generation) this.fail(error)
        },
      })
      this.driver = capture.createRecorder(this.snapshot.settings)
      this.stopped = new Promise((resolve) => {
        this.resolveStopped = resolve
      })
      this.unlistenRecorder = this.driver.listen({
        data: (chunk) => {
          if (generation === this.generation) this.writer?.enqueue(chunk)
        },
        stop: () => {
          if (generation !== this.generation) return
          this.resolveStopped?.()
          if (this.snapshot.phase === 'recording') {
            void this.stop(message('interruptedRecorder'), true)
          }
        },
        error: (error) => {
          if (generation === this.generation) this.fail(error)
        },
      })
      this.startedAt = this.environment.now()
      this.update({ phase: 'recording' })
      this.driver.start(1000)
      if (generation === this.generation && this.getSnapshot().phase === 'recording') {
        this.timer = setInterval(
          () => this.update({ elapsedMs: this.environment.now() - this.startedAt }),
          250,
        )
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    }
  }

  stop(reason?: Message, alreadyStopped = false): Promise<void> {
    if (this.stopping) return this.stopping
    if (this.snapshot.phase !== 'recording') return Promise.resolve()
    const generation = this.generation
    const driver = this.driver
    const writer = this.writer
    this.clearTimer()
    this.update({
      phase: 'finalizing',
      elapsedMs: this.environment.now() - this.startedAt,
      interruption: reason ?? null,
    })
    // Assign the promise before stop() can synchronously emit a final chunk.
    this.stopping = Promise.resolve().then(async () => {
      try {
        if (!alreadyStopped) driver?.stop()
        await this.stopped
        if (generation !== this.generation) return
        if (this.snapshot.writtenBytes + this.snapshot.pendingBytes === 0) {
          throw new RecordingError(message('errorNoData'))
        }
        this.releaseCapture()
        this.update({ preview: null })
        await writer?.finalize()
        if (generation !== this.generation) return
        this.unlistenRecorder?.()
        this.unlistenRecorder = null
        this.driver = null
        this.writer = null
        this.update({ phase: 'completed', pendingBytes: 0 })
      } catch (error) {
        if (generation === this.generation) this.fail(error)
      }
    })
    return this.stopping
  }

  reset(): void {
    if (['recording', 'finalizing', 'preparing', 'starting'].includes(this.snapshot.phase)) return
    this.dispose()
    this.snapshot = {
      ...initialSnapshot(),
      audioInputs: this.snapshot.audioInputs,
      settings: this.snapshot.settings,
    }
    this.emit()
  }

  dispose(): void {
    this.generation++
    this.clearTimer()
    this.unlistenRecorder?.()
    this.unlistenRecorder = null
    try {
      this.driver?.stop()
    } catch {
      /* already stopped */
    }
    this.driver = null
    this.resolveStopped?.()
    this.resolveStopped = null
    this.stopping = null
    void this.writer?.abort()
    this.writer = null
    this.releaseCapture()
  }

  private fail(error: unknown): void {
    this.dispose()
    this.update({
      phase: 'error',
      preview: null,
      fileName: null,
      sourceLabel: null,
      microphones: [],
      pendingBytes: 0,
      message: describeError(error),
    })
  }

  private releaseCapture(): void {
    this.unlistenCapture?.()
    this.unlistenCapture = null
    this.capture?.release()
    this.capture = null
  }

  private canPrepare(): boolean {
    return ['idle', 'ready', 'error'].includes(this.snapshot.phase)
  }
  private preparationDone(message: Message | null = null): void {
    this.update({ phase: this.capture ? 'ready' : 'idle', message })
  }
  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  private update(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }
  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
