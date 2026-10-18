import { message } from '../i18n/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type RecordingSettings } from './settings'
import type { AudioInputs } from './types'
import {
  browserEnvironment,
  MP4_MIME,
  VIDEO_MP4_MIME,
  unsupportedReason,
  formatUnsupportedReason,
  recorderMimeType,
} from './browser'

const captureDefault = (inputs: AudioInputs) => browserEnvironment.capture(inputs, DEFAULT_SETTINGS)

function track(kind: string) {
  return Object.assign(new EventTarget(), {
    kind,
    readyState: 'live',
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'test-mic' }),
  })
}
class Stream {
  constructor(private tracks: ReturnType<typeof track>[]) {}
  getTracks = () => this.tracks
  getAudioTracks = () => this.tracks.filter((item) => item.kind === 'audio')
  getVideoTracks = () => this.tracks.filter((item) => item.kind === 'video')
}
function stream(tracks: ReturnType<typeof track>[]) {
  return new Stream(tracks)
}
function setup(CaptureController?: unknown) {
  const close = vi.fn(async () => {})
  const contextCreated = vi.fn()
  class Node {
    connect = vi.fn((target: Node) => target)
    disconnect = vi.fn()
    getFloatTimeDomainData(samples: Float32Array) {
      samples.fill(0.1)
    }
  }
  const createSource = vi.fn<(stream: Stream) => Node>(() => new Node())
  const mixedTrack = track('audio')
  class Context extends EventTarget {
    constructor() {
      super()
      contextCreated()
    }
    state = 'running'
    resume = vi.fn(async () => {})
    close = close
    createMediaStreamSource = createSource
    createMediaStreamDestination = () => Object.assign(new Node(), { stream: stream([mixedTrack]) })
  }
  const media = {
    getDisplayMedia: vi.fn(),
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn(async () => []),
  }
  const record = vi.fn()
  class Recorder extends EventTarget {
    static isTypeSupported = vi.fn<(mimeType: string) => boolean>(() => true)
    constructor(input: Stream, options: MediaRecorderOptions) {
      super()
      record(input, options)
    }
  }
  const picker = vi.fn()
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('GainNode', Node)
  vi.stubGlobal('DynamicsCompressorNode', Node)
  vi.stubGlobal('AnalyserNode', Node)
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('navigator', { mediaDevices: media })
  vi.stubGlobal('window', {
    isSecureContext: true,
    CaptureController,
    AudioContext: Context,
    MediaRecorder: Recorder,
    showSaveFilePicker: picker,
  })
  return { media, close, Recorder, record, createSource, contextCreated, mixedTrack, picker }
}
afterEach(() => vi.unstubAllGlobals())

describe('browser capture boundary', () => {
  it.each([
    ['mp4', true, MP4_MIME],
    ['mp4', false, VIDEO_MP4_MIME],
    ['webm', true, 'video/webm;codecs=vp9,opus'],
    ['webm', false, 'video/webm;codecs=vp9'],
  ] as const)(
    'applies recording settings for %s with audio=%s',
    async (format, hasAudio, mimeType) => {
      const { media, record } = setup()
      const settings: RecordingSettings = {
        ...DEFAULT_SETTINGS,
        format,
        resolution: '1440p',
        frameRate: 60,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 192_000,
      }
      media.getDisplayMedia.mockResolvedValue(stream([track('video')]))
      media.getUserMedia.mockResolvedValue(stream([track('audio')]))
      const capture = await browserEnvironment.capture({ pc: false, mic: hasAudio }, settings)
      expect(media.getDisplayMedia.mock.calls[0][0].video).toEqual({
        width: { max: 2560 },
        height: { max: 1440 },
        frameRate: { max: 60 },
      })
      capture.createRecorder(settings)
      expect(record.mock.calls[0][1]).toEqual({
        mimeType,
        videoBitsPerSecond: 8_000_000,
        ...(hasAudio ? { audioBitsPerSecond: 192_000 } : {}),
      })
      capture.release()
    },
  )

  it.each([true, false])('falls back to VP8 when VP9 is unavailable, audio=%s', (hasAudio) => {
    const { Recorder } = setup()
    Recorder.isTypeSupported.mockImplementation((type) => type.includes('vp8'))
    expect(recorderMimeType('webm', hasAudio)).toBe(
      hasAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
    )
    expect(formatUnsupportedReason('mp4', hasAudio)).toEqual(
      message(hasAudio ? 'errorFormatUnsupported' : 'errorSilentFormatUnsupported', {
        format: 'MP4',
      }),
    )
    expect(formatUnsupportedReason('webm', hasAudio)).toBeNull()
    expect(unsupportedReason()).toBeNull()
  })

  it('rejects an unsupported format before requesting permissions', async () => {
    const { Recorder, media, contextCreated } = setup()
    Recorder.isTypeSupported.mockReturnValue(false)
    await expect(
      browserEnvironment.capture({ pc: true, mic: true }, { ...DEFAULT_SETTINGS, format: 'webm' }),
    ).rejects.toMatchObject({ detail: message('errorFormatUnsupported', { format: 'WebM' }) })
    expect(media.getDisplayMedia).not.toHaveBeenCalled()
    expect(media.getUserMedia).not.toHaveBeenCalled()
    expect(contextCreated).not.toHaveBeenCalled()
  })

  it.each(['mp4', 'webm'] as const)(
    'selects a matching filename and streams %s to the file',
    async (format) => {
      const { picker } = setup()
      const writable = {
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
      }
      picker.mockResolvedValue({ name: `meeting.${format}`, createWritable: async () => writable })
      const target = await browserEnvironment.chooseFile(format)
      expect(picker.mock.calls[0][0]).toMatchObject({
        suggestedName: expect.stringMatching(new RegExp(`\\.${format}$`)),
        types: [{ accept: { [`video/${format}`]: [`.${format}`] } }],
      })
      const sink = await target.open()
      const chunk = new Blob(['recorded chunk'])
      await sink.write(chunk)
      await sink.close()
      expect(writable.write).toHaveBeenCalledWith(chunk)
      expect(writable.close).toHaveBeenCalledOnce()
    },
  )

  it('does not write WebM to a file with the MP4 extension', async () => {
    const { picker } = setup()
    const createWritable = vi.fn()
    picker.mockResolvedValue({ name: 'meeting.mp4', createWritable })
    await expect(browserEnvironment.chooseFile('webm')).rejects.toMatchObject({
      detail: message('errorFileExtension', { extension: '.webm' }),
    })
    expect(createWritable).not.toHaveBeenCalled()
  })

  it.each([
    { pc: true, mic: true },
    { pc: true, mic: false },
    { pc: false, mic: true },
    { pc: false, mic: false },
  ])('records only the selected audio sources: %j', async (audioInputs) => {
    const { media, record, createSource, contextCreated, close, mixedTrack } = setup()
    const video = track('video')
    const pc = track('audio')
    const mic = track('audio')
    const display = stream(audioInputs.pc ? [video, pc] : [video])
    const microphone = stream([mic])
    media.getDisplayMedia.mockResolvedValue(display)
    media.getUserMedia.mockResolvedValue(microphone)
    const capture = await captureDefault(audioInputs)
    expect(media.getDisplayMedia.mock.calls[0][0]).toMatchObject({
      audio: audioInputs.pc ? { suppressLocalAudioPlayback: false } : false,
      systemAudio: audioInputs.pc ? 'include' : 'exclude',
      windowAudio: audioInputs.pc ? 'system' : 'exclude',
    })
    expect(media.getUserMedia).toHaveBeenCalledTimes(Number(audioInputs.mic))
    expect(media.enumerateDevices).toHaveBeenCalledTimes(Number(audioInputs.mic))
    expect(createSource.mock.calls.map(([input]) => input)).toEqual([
      ...(audioInputs.pc ? [display] : []),
      ...(audioInputs.mic ? [microphone] : []),
    ])
    expect(capture.levels().pc > 0).toBe(audioInputs.pc)
    expect(capture.levels().mic > 0).toBe(audioInputs.mic)
    if (!audioInputs.mic) {
      expect(capture.selectedMicrophone).toBe('')
      expect(capture.microphones).toEqual([])
      await capture.replaceMicrophone('another-device')
      expect(media.getUserMedia).not.toHaveBeenCalled()
    }
    capture.createRecorder(DEFAULT_SETTINGS)
    const hasAudio = audioInputs.pc || audioInputs.mic
    const [recorded, options] = record.mock.calls[0]
    expect(recorded.getTracks()).toEqual(hasAudio ? [video, mixedTrack] : [video])
    expect(options.mimeType).toBe(hasAudio ? MP4_MIME : VIDEO_MP4_MIME)
    if (!hasAudio) expect(options).not.toHaveProperty('audioBitsPerSecond')
    expect(contextCreated).toHaveBeenCalledTimes(Number(hasAudio))
    capture.release()
    expect(video.stop).toHaveBeenCalledOnce()
    expect(mic.stop).toHaveBeenCalledTimes(Number(audioInputs.mic))
    expect(close).toHaveBeenCalledTimes(Number(hasAudio))
  })

  it('excludes unexpected PC audio when disabled, including its ended events', async () => {
    const { media, createSource } = setup()
    const video = track('video')
    const pc = track('audio')
    media.getDisplayMedia.mockResolvedValue(stream([video, pc]))
    media.getUserMedia.mockResolvedValue(stream([track('audio')]))
    const capture = await captureDefault({ pc: false, mic: true })
    const ended = vi.fn()
    capture.onEnded(ended)
    expect(pc.stop).toHaveBeenCalledOnce()
    expect(createSource).toHaveBeenCalledOnce()
    pc.dispatchEvent(new Event('ended'))
    expect(ended).not.toHaveBeenCalled()
    video.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledOnce()
    capture.release()
  })

  it('still requires microphone audio when only the microphone is selected', async () => {
    const { media, close } = setup()
    const video = track('video')
    media.getDisplayMedia.mockResolvedValue(stream([video]))
    media.getUserMedia.mockResolvedValue(stream([]))
    await expect(captureDefault({ pc: false, mic: true })).rejects.toThrow('errorMicEnded')
    expect(video.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('detects a selected audio track that ends before recording starts', async () => {
    const { media } = setup()
    const pc = track('audio')
    media.getDisplayMedia.mockResolvedValue(stream([track('video'), pc]))
    const capture = await captureDefault({ pc: true, mic: false })
    const ended = vi.fn()
    capture.onEnded(ended)
    pc.readyState = 'ended'
    pc.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledOnce()
    expect(() => capture.createRecorder(DEFAULT_SETTINGS)).toThrow('errorPcEnded')
    capture.release()
  })

  it('keeps focus on the recorder before opening each picker, including a retry after cancellation', async () => {
    class Controller {
      focusBehavior: string | undefined
      setFocusBehavior(behavior: string) {
        this.focusBehavior = behavior
      }
    }
    const { media } = setup(Controller)
    media.getDisplayMedia.mockImplementation(async (options) => {
      expect(options.controller).toBeInstanceOf(Controller)
      expect(options.controller.focusBehavior).toBe('no-focus-change')
      throw new DOMException('Canceled', 'NotAllowedError')
    })
    await expect(captureDefault({ pc: true, mic: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    await expect(captureDefault({ pc: true, mic: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    // A controller can be bound to only one getDisplayMedia call.
    expect(media.getDisplayMedia.mock.calls[0][0].controller).not.toBe(
      media.getDisplayMedia.mock.calls[1][0].controller,
    )
  })

  it.each([
    ['no CaptureController', undefined],
    ['no focus method', class Controller {}],
    [
      'a rejected focus preference',
      class Controller {
        setFocusBehavior() {
          throw new DOMException('Unsupported', 'NotSupportedError')
        }
      },
    ],
  ])('still requests screen and microphone capture with %s', async (_label, Controller) => {
    const { media } = setup(Controller)
    const tracks = [track('video'), track('audio')]
    media.getDisplayMedia.mockResolvedValue(stream(tracks))
    media.getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    await expect(captureDefault({ pc: true, mic: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    expect(media.getDisplayMedia).toHaveBeenCalledOnce()
    expect(media.getDisplayMedia.mock.calls[0][0]).not.toHaveProperty('controller')
    expect(media.getUserMedia).toHaveBeenCalledOnce()
    tracks.forEach((item) => expect(item.stop).toHaveBeenCalledOnce())
  })

  it('closes the audio context after a rejected screen permission', async () => {
    const { media, close } = setup()
    media.getDisplayMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    await expect(captureDefault({ pc: true, mic: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    expect(close).toHaveBeenCalledOnce()
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })

  it('rejects a screen without PC audio and releases the screen track', async () => {
    const { media, close } = setup()
    const video = track('video')
    media.getDisplayMedia.mockResolvedValue(stream([video]))
    await expect(captureDefault({ pc: true, mic: true })).rejects.toThrow('errorPcMissing')
    expect(video.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })

  it('releases both screen tracks if microphone permission fails', async () => {
    const { media } = setup()
    const tracks = [track('video'), track('audio')]
    media.getDisplayMedia.mockResolvedValue(stream(tracks))
    media.getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    await expect(captureDefault({ pc: true, mic: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    tracks.forEach((item) => expect(item.stop).toHaveBeenCalledOnce())
  })

  it('rejects tracks that ended during setup and releases the microphone', async () => {
    const { media } = setup()
    const video = track('video')
    video.readyState = 'ended'
    const mic = track('audio')
    media.getDisplayMedia.mockResolvedValue(stream([video, track('audio')]))
    media.getUserMedia.mockResolvedValue(stream([mic]))
    await expect(captureDefault({ pc: true, mic: true })).rejects.toThrow('errorScreenEnded')
    expect(mic.stop).toHaveBeenCalledOnce()
  })

  it('explains when the required codec is unavailable', () => {
    const { Recorder } = setup()
    Recorder.isTypeSupported.mockReturnValue(false)
    expect(unsupportedReason()).toBeNull()
    expect(formatUnsupportedReason('mp4', true)).toEqual(
      message('errorFormatUnsupported', { format: 'MP4' }),
    )
  })
})
