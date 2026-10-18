import {
  AUDIO_BITRATES,
  DEFAULT_SETTINGS,
  FORMATS,
  FRAME_RATES,
  RESOLUTIONS,
  VIDEO_BITRATES,
} from './settings'
import type { Snapshot } from './types'

export type RecordingPreferences = Pick<Snapshot, 'settings' | 'audioInputs'>
export const PREFERENCES_KEY = 'screen-recorder.preferences.v1'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function choice<T extends string | number>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.find((candidate) => candidate === value) ?? fallback
}

export function loadPreferences(): RecordingPreferences {
  let stored: Record<string, unknown> = {}
  try {
    stored = object(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? 'null'))
  } catch {
    // Disabled storage or malformed data must not prevent recording.
  }
  const settings = object(stored.settings)
  const audio = object(stored.audioInputs)
  return {
    settings: {
      format: choice(
        settings.format,
        Object.keys(FORMATS) as (keyof typeof FORMATS)[],
        DEFAULT_SETTINGS.format,
      ),
      resolution: choice(
        settings.resolution,
        Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[],
        DEFAULT_SETTINGS.resolution,
      ),
      frameRate: choice(settings.frameRate, FRAME_RATES, DEFAULT_SETTINGS.frameRate),
      videoBitsPerSecond: choice(
        settings.videoBitsPerSecond,
        VIDEO_BITRATES,
        DEFAULT_SETTINGS.videoBitsPerSecond,
      ),
      audioBitsPerSecond: choice(
        settings.audioBitsPerSecond,
        AUDIO_BITRATES,
        DEFAULT_SETTINGS.audioBitsPerSecond,
      ),
    },
    audioInputs: {
      pc: typeof audio.pc === 'boolean' ? audio.pc : true,
      mic: typeof audio.mic === 'boolean' ? audio.mic : true,
    },
  }
}

export function savePreferences({ settings, audioInputs }: RecordingPreferences): void {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ settings, audioInputs }))
  } catch {
    // Continue with the current settings when storage is unavailable or full.
  }
}
