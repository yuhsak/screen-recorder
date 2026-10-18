import type { RecordingFormat, RecordingSettings } from './settings'
import type { Message } from '../i18n/messages'

export type Phase =
  'idle' | 'preparing' | 'ready' | 'recording' | 'finalizing' | 'completed' | 'error'

export interface FileSink {
  write(chunk: Blob): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface SaveTarget {
  name: string
  open(): Promise<FileSink>
}

export interface RecorderEvents {
  data: (chunk: Blob) => void
  stop: () => void
  error: (error: unknown) => void
}

export interface RecorderDriver {
  listen(events: RecorderEvents): () => void
  start(timeslice: number): void
  stop(): void
}

export interface Microphone {
  deviceId: string
  label: string
}

export type AudioInputs = Readonly<{ pc: boolean; mic: boolean }>

export interface Capture {
  preview: MediaStream | null
  sourceLabel: string
  selectedMicrophone: string
  microphones: Microphone[]
  createRecorder(settings: RecordingSettings): RecorderDriver
  replaceMicrophone(deviceId: string): Promise<void>
  levels(): { pc: number; mic: number }
  onEnded(callback: (reason: Message) => void): () => void
  release(): void
}

export interface RecordingEnvironment {
  chooseFile(format: RecordingFormat): Promise<SaveTarget>
  capture(audioInputs: AudioInputs, settings: RecordingSettings): Promise<Capture>
  now(): number
}

export interface Snapshot {
  phase: Phase
  fileName: string | null
  sourceLabel: string | null
  preview: MediaStream | null
  microphones: Microphone[]
  selectedMicrophone: string
  audioInputs: AudioInputs
  settings: RecordingSettings
  elapsedMs: number
  writtenBytes: number
  pendingBytes: number
  message: Message | null
  interruption: Message | null
}
