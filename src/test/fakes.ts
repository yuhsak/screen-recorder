import type { Message } from '../i18n/messages'
import { vi } from 'vitest'
import { RecordingSession } from '../recording/session'
import type {
  Capture,
  FileSink,
  RecorderDriver,
  RecorderEvents,
  RecordingEnvironment,
  SaveTarget,
} from '../recording/types'

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export class FakeRecorder implements RecorderDriver {
  events: RecorderEvents | null = null
  autoStop = true
  finalChunk: Blob | null = new Blob(['header'])
  start = vi.fn()
  stop = vi.fn(() => {
    if (this.autoStop) this.finish()
  })
  listen(events: RecorderEvents) {
    this.events = events
    return () => {
      this.events = null
    }
  }
  data(chunk: Blob) {
    this.events?.data(chunk)
  }
  finish() {
    if (this.finalChunk) this.data(this.finalChunk)
    this.events?.stop()
  }
}

export class FakeCapture implements Capture {
  preview = null
  sourceLabel = 'テスト会議'
  selectedMicrophone = 'mic-1'
  microphones = [{ deviceId: 'mic-1', label: 'テストマイク' }]
  driver = new FakeRecorder()
  ended: ((reason: Message) => void) | null = null
  createRecorder = vi.fn(() => this.driver)
  replaceMicrophone = vi.fn(async (id: string) => {
    this.selectedMicrophone = id
  })
  levels = () => ({ pc: 0.4, mic: 0.2 })
  release = vi.fn()
  onEnded(callback: (reason: Message) => void) {
    this.ended = callback
    return () => {
      this.ended = null
    }
  }
}

export function setupSession() {
  const sink: FileSink = {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  }
  const target: SaveTarget = { name: 'meeting-test.mp4', open: vi.fn(async () => sink) }
  const capture = new FakeCapture()
  const environment: RecordingEnvironment = {
    chooseFile: vi.fn(async () => target),
    capture: vi.fn(async () => capture),
    now: vi.fn(() => 1000),
  }
  const session = new RecordingSession(environment)
  return { session, environment, target, sink, capture, driver: capture.driver }
}

export async function ready(session: RecordingSession) {
  await session.prepareCapture()
}
export async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}
