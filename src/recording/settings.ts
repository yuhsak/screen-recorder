export const RESOLUTIONS = {
  '720p': { width: 1280, height: 720, label: '720p' },
  '1080p': { width: 1920, height: 1080, label: '1080p' },
  '1440p': { width: 2560, height: 1440, label: '1440p' },
  '2160p': { width: 3840, height: 2160, label: '4K (2160p)' },
} as const

export const FRAME_RATES = [5, 15, 24, 30, 60] as const
export const VIDEO_BITRATES = [
  1_000_000, 2_000_000, 4_000_000, 8_000_000, 12_000_000, 20_000_000,
] as const
export const AUDIO_BITRATES = [64_000, 96_000, 128_000, 192_000, 256_000] as const
export const FORMATS = {
  mp4: { label: 'MP4', mimeType: 'video/mp4', extension: '.mp4' },
  webm: { label: 'WebM', mimeType: 'video/webm', extension: '.webm' },
} as const

export type RecordingFormat = keyof typeof FORMATS
export interface RecordingSettings {
  readonly format: RecordingFormat
  readonly resolution: keyof typeof RESOLUTIONS
  readonly frameRate: number
  readonly videoBitsPerSecond: number
  readonly audioBitsPerSecond: number
}

export const DEFAULT_SETTINGS: RecordingSettings = Object.freeze({
  format: 'mp4',
  resolution: '1440p',
  frameRate: 30,
  videoBitsPerSecond: 8_000_000,
  audioBitsPerSecond: 192_000,
})

export function sameSettings(a: RecordingSettings, b: RecordingSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof RecordingSettings)[]).every(
    (key) => a[key] === b[key],
  )
}

export function captureSettingsChanged(a: RecordingSettings, b: RecordingSettings): boolean {
  return a.resolution !== b.resolution || a.frameRate !== b.frameRate
}
