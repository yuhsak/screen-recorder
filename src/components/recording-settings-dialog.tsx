import { useI18n } from '@/i18n/context'
import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AUDIO_BITRATES,
  DEFAULT_SETTINGS,
  FORMATS,
  FRAME_RATES,
  RESOLUTIONS,
  VIDEO_BITRATES,
  captureSettingsChanged,
  type RecordingFormat,
  type RecordingSettings,
} from '@/recording/settings'

function SettingField({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface Props {
  settings: RecordingSettings
  disabled: boolean
  hasAudio: boolean
  hasCapture: boolean
  checkFormat: (format: RecordingFormat) => string | null
  onApply: (settings: RecordingSettings) => void
}

export function RecordingSettingsDialog({
  settings,
  disabled,
  hasAudio,
  hasCapture,
  checkFormat,
  onApply,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(settings)
  const error = open ? checkFormat(draft.format) : null
  // Decimal GB: both inputs share one mixed audio track, so count its bitrate once.
  const gigabytesPerHour =
    ((draft.videoBitsPerSecond + (hasAudio ? draft.audioBitsPerSecond : 0)) * 3600) /
    8 /
    1_000_000_000
  const update = <K extends keyof RecordingSettings>(key: K, value: RecordingSettings[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) setDraft(settings)
        setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={t('recordingSettings')}
          className="text-[11px] text-muted-foreground"
        >
          <SlidersHorizontal className="size-3" />
          {t('settings')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('recordingSettings')}</DialogTitle>
          <DialogDescription>{t('settingsDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (disabled || error) return
            onApply(draft)
            setOpen(false)
          }}
        >
          <SettingField
            id="recording-format"
            label={t('videoFormat')}
            value={draft.format}
            options={Object.entries(FORMATS).map(([value, format]) => ({
              value,
              label: format.label,
            }))}
            onChange={(value) => update('format', value as RecordingFormat)}
          />
          <div className="grid grid-cols-2 gap-4">
            <SettingField
              id="recording-resolution"
              label={t('videoResolution')}
              value={draft.resolution}
              options={Object.entries(RESOLUTIONS).map(([value, resolution]) => ({
                value,
                label: resolution.label,
              }))}
              onChange={(value) => update('resolution', value as RecordingSettings['resolution'])}
            />
            <SettingField
              id="recording-frame-rate"
              label={t('frameRate')}
              value={String(draft.frameRate)}
              options={FRAME_RATES.map((value) => ({
                value: String(value),
                label: `${value} fps`,
              }))}
              onChange={(value) => update('frameRate', Number(value))}
            />
            <SettingField
              id="recording-video-bitrate"
              label={t('videoBitrate')}
              value={String(draft.videoBitsPerSecond)}
              options={VIDEO_BITRATES.map((value) => ({
                value: String(value),
                label: `${value / 1_000_000} Mbps`,
              }))}
              onChange={(value) => update('videoBitsPerSecond', Number(value))}
            />
            <SettingField
              id="recording-audio-bitrate"
              label={t('audioBitrate')}
              value={String(draft.audioBitsPerSecond)}
              options={AUDIO_BITRATES.map((value) => ({
                value: String(value),
                label: `${value / 1000} kbps`,
              }))}
              onChange={(value) => update('audioBitsPerSecond', Number(value))}
              disabled={!hasAudio}
            />
          </div>
          <div className="space-y-2 rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-foreground">
              <span className="text-xs">{t('hourlySize')}</span>
              <output
                aria-label={t('hourlySizeLabel')}
                className="text-lg font-medium tabular-nums"
              >
                {t('sizeEstimate', { size: gigabytesPerHour.toFixed(2) })}
              </output>
            </div>
            <p>{t('bitrateEstimateHint')}</p>
            <p>{t('limitsHint')}</p>
            <p>{t('codecHint')}</p>
            {!hasAudio && <p>{t('noAudioBitrate')}</p>}
          </div>
          {hasCapture && captureSettingsChanged(settings, draft) && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('captureChangeHint')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-0 text-xs text-muted-foreground"
            onClick={() => setDraft(DEFAULT_SETTINGS)}
          >
            {t('restoreDefaults')}
          </Button>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={disabled || Boolean(error)}>
              {t('applySettings')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
