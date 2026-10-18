// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import { loadPreferences, PREFERENCES_KEY, savePreferences } from './preferences'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('remembered preferences', () => {
  it('uses defaults on first visit and after unreadable data', () => {
    const defaults = { settings: DEFAULT_SETTINGS, audioInputs: { pc: true, mic: true } }
    expect(loadPreferences()).toEqual(defaults)
    for (const raw of ['{broken', 'null', '[]', '42']) {
      localStorage.setItem(PREFERENCES_KEY, raw)
      expect(loadPreferences()).toEqual(defaults)
    }
  })

  it('restores valid choices and replaces invalid individual values with defaults', () => {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        settings: {
          format: 'webm',
          resolution: '8K',
          frameRate: '60',
          videoBitsPerSecond: -1,
          audioBitsPerSecond: 256_000,
        },
        audioInputs: { pc: false, mic: 'false' },
      }),
    )
    expect(loadPreferences()).toEqual({
      settings: { ...DEFAULT_SETTINGS, format: 'webm', audioBitsPerSecond: 256_000 },
      audioInputs: { pc: false, mic: true },
    })
  })

  it('persists only preferences, never recording targets or device identities', () => {
    const preferences = {
      settings: { ...DEFAULT_SETTINGS, frameRate: 60 },
      audioInputs: { pc: false, mic: false },
    }
    const snapshot = {
      ...preferences,
      fileName: 'private-recording.mp4',
      sourceLabel: 'Private window',
      selectedMicrophone: 'private-device-id',
    }
    savePreferences(snapshot)
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toEqual(preferences)
    expect(loadPreferences()).toEqual(preferences)
  })

  it('continues with defaults when accessing localStorage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    expect(loadPreferences()).toEqual({
      settings: DEFAULT_SETTINGS,
      audioInputs: { pc: true, mic: true },
    })
    expect(() => savePreferences(loadPreferences())).not.toThrow()
  })

  it('keeps recording available when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    expect(() =>
      savePreferences({
        settings: DEFAULT_SETTINGS,
        audioInputs: { pc: true, mic: false },
      }),
    ).not.toThrow()
  })
})
