import { message, type Message } from '../i18n/messages'
import { AudioMixer } from './audio-mixer'
import { RecordingError } from './errors'
import { FORMATS, RESOLUTIONS, type RecordingFormat, type RecordingSettings } from './settings'
import type {
  AudioInputs,
  Capture,
  Microphone,
  RecorderDriver,
  RecorderEvents,
  RecordingEnvironment,
  SaveTarget,
} from './types'

export const MP4_MIME = 'video/mp4;codecs=avc1,mp4a.40.2'
export const VIDEO_MP4_MIME = 'video/mp4;codecs=avc1'

// CaptureController is not yet declared by the project's DOM typings.
interface CaptureFocusController {
  setFocusBehavior(behavior: 'no-focus-change'): void
}

function createFocusController(): CaptureFocusController | undefined {
  const Controller = (window as Window & { CaptureController?: new () => CaptureFocusController })
    .CaptureController
  if (
    typeof Controller !== 'function' ||
    typeof Controller.prototype.setFocusBehavior !== 'function'
  )
    return undefined
  try {
    const controller = new Controller()
    // Set before opening the picker: after capture resolves, the focus decision
    // is finalized within a microtask, before microphone permission can finish.
    controller.setFocusBehavior('no-focus-change')
    return controller
  } catch {
    // Focus control is optional; keep screen capture available if it fails.
    return undefined
  }
}

export function unsupportedReason(): Message | null {
  if (!window.isSecureContext) return message('errorInsecure')
  if (
    !navigator.mediaDevices?.getDisplayMedia ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.AudioContext
  ) {
    return message('errorCaptureUnsupported')
  }
  if (!('showSaveFilePicker' in window)) return message('errorFileUnsupported')
  if (!window.MediaRecorder) return message('errorRecorderUnsupported')
  return null
}

export function recorderMimeType(format: RecordingFormat, hasAudio: boolean): string | null {
  if (!window.MediaRecorder) return null
  const candidates =
    format === 'mp4'
      ? [hasAudio ? MP4_MIME : VIDEO_MP4_MIME]
      : hasAudio
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export function formatUnsupportedReason(
  format: RecordingFormat,
  hasAudio: boolean,
): Message | null {
  return recorderMimeType(format, hasAudio)
    ? null
    : message(hasAudio ? 'errorFormatUnsupported' : 'errorSilentFormatUnsupported', {
        format: FORMATS[format].label,
      })
}

function stopTracks(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

function requireLiveTracks(
  display: MediaStream,
  mic: MediaStream | undefined,
  audioInputs: AudioInputs,
): void {
  if (!display.getVideoTracks().some((track) => track.readyState === 'live'))
    throw new RecordingError(message('errorScreenEnded'))
  if (audioInputs.pc && !display.getAudioTracks().some((track) => track.readyState === 'live'))
    throw new RecordingError(message('errorPcEnded'))
  if (audioInputs.mic && !mic?.getAudioTracks().some((track) => track.readyState === 'live'))
    throw new RecordingError(message('errorMicEnded'))
}

async function microphones(): Promise<Microphone[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
    }))
}

class BrowserRecorder implements RecorderDriver {
  constructor(private readonly recorder: MediaRecorder) {}
  listen(events: RecorderEvents): () => void {
    const data = (event: BlobEvent) => events.data(event.data)
    const stop = () => events.stop()
    const error = () => events.error(new RecordingError(message('errorRecording')))
    this.recorder.addEventListener('dataavailable', data)
    this.recorder.addEventListener('stop', stop)
    this.recorder.addEventListener('error', error)
    return () => {
      this.recorder.removeEventListener('dataavailable', data)
      this.recorder.removeEventListener('stop', stop)
      this.recorder.removeEventListener('error', error)
    }
  }
  start(timeslice: number): void {
    this.recorder.start(timeslice)
  }
  stop(): void {
    if (this.recorder.state !== 'inactive') this.recorder.stop()
  }
}

class BrowserCapture implements Capture {
  readonly preview: MediaStream
  readonly sourceLabel: string
  selectedMicrophone: string
  microphones: Microphone[]
  private readonly mixer: AudioMixer | undefined
  private released = false
  private callbacks = new Set<(reason: Message) => void>()
  private unbindTracks: (() => void) | null = null
  private contextChanged = () => {
    if (!this.released && this.context?.state === 'suspended')
      this.emitEnded(message('interruptedAudio'))
  }

  constructor(
    private readonly context: AudioContext | undefined,
    private readonly display: MediaStream,
    private mic: MediaStream | undefined,
    devices: Microphone[],
    private readonly audioInputs: AudioInputs,
  ) {
    this.preview = new MediaStream(display.getVideoTracks())
    this.sourceLabel = display.getVideoTracks()[0]?.label || ''
    this.selectedMicrophone = mic
      ? mic.getAudioTracks()[0]?.getSettings().deviceId || 'default'
      : ''
    this.microphones = devices
    this.mixer = context
      ? new AudioMixer(context, audioInputs.pc ? display : undefined, mic)
      : undefined
    this.bindTracks()
    this.context?.addEventListener('statechange', this.contextChanged)
  }

  createRecorder(settings: RecordingSettings): RecorderDriver {
    requireLiveTracks(this.display, this.mic, this.audioInputs)
    const mimeType = recorderMimeType(settings.format, Boolean(this.mixer))
    if (!mimeType)
      throw new RecordingError(formatUnsupportedReason(settings.format, Boolean(this.mixer))!)
    if (this.context && this.context.state !== 'running')
      throw new RecordingError(message('errorAudioStopped'))
    const stream = new MediaStream([
      ...this.display.getVideoTracks(),
      ...(this.mixer?.destination.stream.getAudioTracks() ?? []),
    ])
    return new BrowserRecorder(
      new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: settings.videoBitsPerSecond,
        ...(this.mixer ? { audioBitsPerSecond: settings.audioBitsPerSecond } : {}),
      }),
    )
  }

  async replaceMicrophone(deviceId: string): Promise<void> {
    if (!this.audioInputs.mic || !this.mixer || this.released) return
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: true },
      video: false,
    })
    if (this.released) {
      stopTracks(next)
      return
    }
    try {
      requireLiveTracks(this.display, next, this.audioInputs)
      const devices = await microphones()
      if (this.released) {
        stopTracks(next)
        return
      }
      this.mixer.replaceMicrophone(next)
      this.unbindTracks?.()
      stopTracks(this.mic)
      this.mic = next
      this.selectedMicrophone = next.getAudioTracks()[0]?.getSettings().deviceId || deviceId
      this.microphones = devices
      this.bindTracks()
    } catch (error) {
      stopTracks(next)
      throw error
    }
  }

  levels(): { pc: number; mic: number } {
    return this.mixer?.levels() ?? { pc: 0, mic: 0 }
  }
  onEnded(callback: (reason: Message) => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.unbindTracks?.()
    this.context?.removeEventListener('statechange', this.contextChanged)
    this.callbacks.clear()
    this.mixer?.release()
    stopTracks(this.display)
    stopTracks(this.mic)
    void this.context?.close().catch(() => undefined)
  }

  private emitEnded(reason: Message): void {
    this.callbacks.forEach((callback) => callback(reason))
  }
  private bindTracks(): void {
    const displayEnded = () =>
      this.emitEnded(
        this.audioInputs.pc ? message('interruptedScreenAudio') : message('interruptedScreen'),
      )
    const micEnded = () => this.emitEnded(message('interruptedMicrophone'))
    const displayTracks = this.display
      .getTracks()
      .filter((track) => track.kind === 'video' || this.audioInputs.pc)
    const micTracks = this.mic?.getTracks() ?? []
    displayTracks.forEach((track) => track.addEventListener('ended', displayEnded))
    micTracks.forEach((track) => track.addEventListener('ended', micEnded))
    this.unbindTracks = () => {
      displayTracks.forEach((track) => track.removeEventListener('ended', displayEnded))
      micTracks.forEach((track) => track.removeEventListener('ended', micEnded))
    }
  }
}

async function capture(audioInputs: AudioInputs, settings: RecordingSettings): Promise<Capture> {
  const hasAudio = audioInputs.pc || audioInputs.mic
  const unsupported = unsupportedReason() ?? formatUnsupportedReason(settings.format, hasAudio)
  if (unsupported) throw new RecordingError(unsupported)
  const resolution = RESOLUTIONS[settings.resolution]
  const context = hasAudio ? new AudioContext() : undefined
  // Both calls begin in the user gesture, without awaiting the permission dialog.
  const resume = context?.resume()
  void resume?.catch(() => undefined)
  let display: MediaStream | undefined
  let mic: MediaStream | undefined
  try {
    const controller = createFocusController()
    const options: DisplayMediaStreamOptions & {
      controller?: CaptureFocusController
      systemAudio: string
      windowAudio: string
      selfBrowserSurface: string
      surfaceSwitching: string
    } = {
      ...(controller ? { controller } : {}),
      video: {
        width: { max: resolution.width },
        height: { max: resolution.height },
        frameRate: { max: settings.frameRate },
      },
      audio: audioInputs.pc
        ? ({ suppressLocalAudioPlayback: false } as MediaTrackConstraints)
        : false,
      systemAudio: audioInputs.pc ? 'include' : 'exclude',
      windowAudio: audioInputs.pc ? 'system' : 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    }
    display = await navigator.mediaDevices.getDisplayMedia(options)
    if (!audioInputs.pc) display.getAudioTracks().forEach((track) => track.stop())
    if (audioInputs.pc && !display.getAudioTracks().length)
      throw new RecordingError(message('errorPcMissing'))
    if (audioInputs.mic) {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true },
        video: false,
      })
    }
    await resume
    const devices = audioInputs.mic ? await microphones() : []
    requireLiveTracks(display, mic, audioInputs)
    return new BrowserCapture(context, display, mic, devices, audioInputs)
  } catch (error) {
    stopTracks(display)
    stopTracks(mic)
    void context?.close().catch(() => undefined)
    throw error
  }
}

export function defaultFileName(date = new Date(), format: RecordingFormat = 'mp4'): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `meeting-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${FORMATS[format].extension}`
}

async function chooseFile(format: RecordingFormat): Promise<SaveTarget> {
  const { label, mimeType, extension } = FORMATS[format]
  const handle = await window.showSaveFilePicker({
    suggestedName: defaultFileName(new Date(), format),
    types: [{ description: label, accept: { [mimeType]: [extension] } }],
    excludeAcceptAllOption: true,
  })
  if (!handle.name.toLowerCase().endsWith(extension))
    throw new RecordingError(message('errorFileExtension', { extension }))
  return {
    name: handle.name,
    async open() {
      const writable = await handle.createWritable()
      return {
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
        abort: () => writable.abort(),
      }
    },
  }
}

export const browserEnvironment: RecordingEnvironment = {
  chooseFile,
  capture,
  now: () => performance.now(),
}
