import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Check,
  CheckCheck,
  CircleHelp,
  CircleStop,
  FileVideo2,
  FolderOpen,
  HardDrive,
  Info,
  Languages,
  LoaderCircle,
  Mic,
  Monitor,
  MonitorUp,
  RefreshCw,
  ShieldCheck,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RecordingSettingsDialog } from '@/components/recording-settings-dialog'
import { cn } from '@/lib/utils'
import { useHydrated } from '@/lib/use-hydrated'
import { browserEnvironment, formatUnsupportedReason, unsupportedReason } from '@/recording/browser'
import { FORMATS, RESOLUTIONS, type RecordingFormat } from '@/recording/settings'
import { RecordingSession } from '@/recording/session'
import { loadPreferences, savePreferences } from '@/recording/preferences'
import { useI18n } from '@/i18n/context'
import { I18nProvider } from '@/i18n/provider'
import type { Locale, Message, MessageKey } from '@/i18n/messages'
import type { AudioInputs, Phase } from '@/recording/types'

const phaseLabels: Record<Phase, MessageKey> = {
  idle: 'phaseIdle',
  preparing: 'phasePreparing',
  ready: 'phaseReady',
  recording: 'phaseRecording',
  finalizing: 'phaseFinalizing',
  completed: 'phaseCompleted',
  error: 'phaseError',
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}
function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function Preview({ stream }: { stream: MediaStream }) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = stream
    void element.play().catch(() => undefined)
    return () => {
      element.srcObject = null
    }
  }, [stream])
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label={t('previewLabel')}
      className="absolute inset-0 h-full w-full object-contain"
    />
  )
}

function Meter({
  label,
  level,
  enabled,
  checked,
  disabled,
  onCheckedChange,
  icon: Icon,
}: {
  label: string
  level: number
  enabled: boolean
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
  icon: typeof Mic
}) {
  const { t } = useI18n()
  return (
    <div className="flex h-5 items-center gap-3">
      <span className="flex flex-1 items-center gap-2 whitespace-nowrap text-xs font-medium">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        {label}
      </span>
      <div
        role="meter"
        aria-label={t('inputLevel', { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={!checked ? t('audioDisabled') : !enabled ? t('awaitingSetup') : undefined}
        title={!checked ? t('audioDisabled') : !enabled ? t('awaitingSetup') : t('audioLevel')}
        className="flex h-2.5 w-16 shrink-0 gap-0.5"
      >
        {Array.from({ length: 16 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-[2px] transition-colors duration-100',
              enabled && i / 16 < level ? (i > 13 ? 'bg-amber-400' : 'bg-zinc-700') : 'bg-zinc-200',
            )}
          />
        ))}
      </div>
      <span aria-hidden className="w-5 text-right font-mono text-[10px] text-muted-foreground">
        {checked ? 'ON' : 'OFF'}
      </span>
      <Switch
        aria-label={t('recordInput', { label })}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function AudioMeters({
  session,
  enabled,
  audioInputs,
  canConfigure,
}: {
  session: RecordingSession
  enabled: boolean
  audioInputs: AudioInputs
  canConfigure: boolean
}) {
  const { t } = useI18n()
  const [levels, setLevels] = useState({ pc: 0, mic: 0 })
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setLevels(session.levels()), 100)
    return () => clearInterval(timer)
  }, [session, enabled])
  return (
    <div className="space-y-2">
      <Meter
        label={t('pcAudio')}
        level={enabled && audioInputs.pc ? levels.pc : 0}
        enabled={enabled && audioInputs.pc}
        checked={audioInputs.pc}
        disabled={!canConfigure}
        onCheckedChange={(checked) => session.setAudioEnabled('pc', checked)}
        icon={Volume2}
      />
      <Meter
        label={t('microphone')}
        level={enabled && audioInputs.mic ? levels.mic : 0}
        enabled={enabled && audioInputs.mic}
        checked={audioInputs.mic}
        disabled={!canConfigure}
        onCheckedChange={(checked) => session.setAudioEnabled('mic', checked)}
        icon={Mic}
      />
    </div>
  )
}

function HelpDialog() {
  const { t } = useI18n()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
          <CircleHelp className="size-4" />
          <span>{t('help')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('helpTitle')}</DialogTitle>
          <DialogDescription>{t('helpBrowser')}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-4 text-sm leading-relaxed">
          <li>
            <strong>{t('helpSaveTitle')}</strong>
            <p className="mt-1 text-muted-foreground">{t('helpSave')}</p>
          </li>
          <li>
            <strong>{t('helpCaptureTitle')}</strong>
            <p className="mt-1 text-muted-foreground">{t('helpCapture')}</p>
          </li>
          <li>
            <strong>{t('helpRecordTitle')}</strong>
            <p className="mt-1 text-muted-foreground">{t('helpRecord')}</p>
          </li>
          <li>
            <strong>{t('helpStopTitle')}</strong>
            <p className="mt-1 text-muted-foreground">{t('helpStop')}</p>
          </li>
        </ol>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('helpRemember')}</p>
        <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
          {t('helpSystemAudio')}
        </p>
      </DialogContent>
    </Dialog>
  )
}

function SetupStep({
  number,
  title,
  complete,
  current,
  children,
}: {
  number: number
  title: string
  complete: boolean
  current: boolean
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <li aria-current={current ? 'step' : undefined} className="border-b px-5 py-4 last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2.5 text-sm font-medium">
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px]',
            complete
              ? 'bg-foreground text-background'
              : current
                ? 'border border-foreground text-foreground'
                : 'border text-muted-foreground',
          )}
        >
          {complete ? <Check className="size-3" /> : String(number).padStart(2, '0')}
        </span>
        {title}
        {complete && <span className="sr-only">{t('completeSuffix')}</span>}
      </h3>
      {children}
    </li>
  )
}

interface AppProps {
  session?: RecordingSession
  unsupported?: Message | null
  pageLocale?: Locale
}
export default function App(props: AppProps) {
  return (
    <I18nProvider pageLocale={props.pageLocale}>
      <RecorderApp {...props} />
    </I18nProvider>
  )
}

function RecorderApp({ session: suppliedSession, unsupported: suppliedUnsupported }: AppProps) {
  const { locale, setLocale, t } = useI18n()
  const hydrated = useHydrated()
  const [session] = useState(
    () =>
      suppliedSession ??
      new RecordingSession(
        browserEnvironment,
        typeof window === 'undefined' ? undefined : loadPreferences(),
      ),
  )
  const [environmentUnsupported] = useState(() =>
    suppliedUnsupported === undefined
      ? typeof window === 'undefined'
        ? null
        : unsupportedReason()
      : suppliedUnsupported,
  )
  const [serverSnapshot] = useState(() => new RecordingSession(browserEnvironment).getSnapshot())
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    () => serverSnapshot,
  )
  const hasAudio = snapshot.audioInputs.pc || snapshot.audioInputs.mic
  const checkFormat = (format: RecordingFormat) =>
    hydrated && suppliedUnsupported === undefined ? formatUnsupportedReason(format, hasAudio) : null
  const unsupported = hydrated
    ? (environmentUnsupported ?? checkFormat(snapshot.settings.format))
    : null
  const formatLabel = FORMATS[snapshot.settings.format].label
  const { phase } = snapshot
  const recording = phase === 'recording'
  const finalizing = phase === 'finalizing'
  const completed = phase === 'completed'
  const busy = phase === 'preparing' || recording || finalizing
  const canConfigure = hydrated && !busy && !completed && !environmentUnsupported
  const hasCapture = snapshot.sourceLabel !== null && !completed

  useEffect(() => () => session.dispose(), [session])
  useEffect(() => {
    if (hydrated)
      savePreferences({ settings: snapshot.settings, audioInputs: snapshot.audioInputs })
  }, [snapshot.settings, snapshot.audioInputs, hydrated])
  useEffect(() => {
    if (!recording && !finalizing) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [recording, finalizing])

  const currentStep = completed ? null : !snapshot.fileName ? 1 : !hasCapture ? 2 : 3

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 max-w-[1360px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:h-16 sm:flex-nowrap sm:px-8 sm:py-0 lg:px-12">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background"
            >
              <span className="flex size-[18px] items-center justify-center rounded-[4px] border-[1.5px] border-current">
                <span className="size-1.5 rounded-full bg-current" />
              </span>
            </div>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight sm:text-xl">
              Screen Recorder
            </span>
          </div>
          <div className="flex items-center gap-2">
            <HelpDialog />
            <Select
              value={locale}
              onValueChange={(value) => {
                if (value === 'ja' || value === 'en') setLocale(value)
              }}
            >
              <SelectTrigger aria-label={t('language')} size="sm" className="w-[116px] text-xs">
                <Languages aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue>{locale === 'ja' ? '日本語' : 'English'}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="ja">
                  <span lang="ja">日本語</span>
                </SelectItem>
                <SelectItem value="en">
                  <span lang="en">English</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] px-5 pb-6 pt-6 sm:px-8 lg:px-12">
        <h1 className="sr-only">Screen Recorder</h1>
        {(unsupported || snapshot.message) && (
          <Alert variant="destructive" className="mb-5 bg-background">
            <Info className="size-4" />
            <AlertTitle>{unsupported ? t('unsupportedTitle') : t('attentionTitle')}</AlertTitle>
            <AlertDescription>{t((unsupported || snapshot.message)!)}</AlertDescription>
          </Alert>
        )}
        {snapshot.interruption && (
          <Alert className="mb-5 border-amber-200 bg-amber-50">
            <Info className="size-4" />
            <AlertTitle>{t('recordingStopped')}</AlertTitle>
            <AlertDescription>
              {t(snapshot.interruption)}
              {completed
                ? t('formatSaved', { format: formatLabel })
                : finalizing
                  ? t('waitForSave')
                  : ''}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <section aria-label={t('recordingControls')} className="min-w-0">
            <Card className="gap-0 overflow-hidden py-0 shadow-xs">
              <div className="flex h-11 items-center justify-between gap-3 border-b px-5">
                <h2 className="text-xs font-medium">
                  {completed
                    ? t('recordingComplete')
                    : recording || finalizing
                      ? t('recordingControls')
                      : t('recordingSetup')}
                </h2>
                <div className="flex items-center gap-1">
                  <RecordingSettingsDialog
                    settings={snapshot.settings}
                    disabled={!canConfigure}
                    hasAudio={hasAudio}
                    hasCapture={hasCapture}
                    hasFile={Boolean(snapshot.fileName)}
                    checkFormat={(format) => {
                      const reason = checkFormat(format)
                      return reason ? t(reason) : null
                    }}
                    onApply={(settings) => session.setRecordingSettings(settings)}
                  />
                  {!completed && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => session.reset()}
                      disabled={busy || (!snapshot.fileName && !hasCapture && phase !== 'error')}
                      className="text-[11px] text-muted-foreground"
                    >
                      <RefreshCw className="size-3" />
                      {t('reset')}
                    </Button>
                  )}
                </div>
              </div>
              <ol aria-label={t('recordingSteps')}>
                <SetupStep
                  number={1}
                  title={t('saveLocation')}
                  complete={Boolean(snapshot.fileName)}
                  current={currentStep === 1}
                >
                  <div className="mb-3 flex h-10 items-center gap-2.5 rounded-md border bg-muted/40 px-3">
                    <FileVideo2 className="size-4 shrink-0 text-muted-foreground" />
                    <p
                      className={cn(
                        'min-w-0 truncate text-xs',
                        !snapshot.fileName && 'text-muted-foreground',
                      )}
                      title={snapshot.fileName ?? undefined}
                    >
                      {snapshot.fileName || t('chooseFilePlaceholder', { format: formatLabel })}
                    </p>
                  </div>
                  <Button
                    variant={snapshot.fileName ? 'outline' : 'default'}
                    onClick={() => void session.chooseFile()}
                    disabled={!canConfigure || Boolean(unsupported)}
                    className="h-10 w-full text-xs"
                  >
                    <FolderOpen className="size-4" />
                    {snapshot.fileName ? t('changeLocation') : t('chooseLocation')}
                  </Button>
                </SetupStep>

                <SetupStep
                  number={2}
                  title={t('screenAudio')}
                  complete={hasCapture || completed}
                  current={currentStep === 2}
                >
                  <div
                    role="group"
                    aria-label={t('audioSources')}
                    className="mb-3 rounded-lg border bg-muted/25 p-3"
                  >
                    <AudioMeters
                      session={session}
                      enabled={hasCapture}
                      audioInputs={snapshot.audioInputs}
                      canConfigure={canConfigure}
                    />
                    <div className="mt-2 min-w-0 border-t pt-2">
                      <Label htmlFor="microphone" className="sr-only">
                        {t('selectMicrophone')}
                      </Label>
                      <Select
                        value={
                          hasCapture && snapshot.audioInputs.mic ? snapshot.selectedMicrophone : ''
                        }
                        onValueChange={(value) => void session.selectMicrophone(value)}
                        disabled={!hasCapture || !canConfigure || !snapshot.audioInputs.mic}
                      >
                        <SelectTrigger
                          id="microphone"
                          size="sm"
                          className="w-full min-w-0 bg-background text-[11px] [&>[data-slot=select-value]]:block [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:flex-1 [&>[data-slot=select-value]]:truncate [&>[data-slot=select-value]]:text-left"
                        >
                          <SelectValue
                            placeholder={
                              snapshot.audioInputs.mic
                                ? t('microphonePlaceholder')
                                : t('microphoneOff')
                            }
                          />
                        </SelectTrigger>
                        <SelectContent
                          position="popper"
                          align="start"
                          className="max-w-[calc(100vw-2rem)]"
                        >
                          {snapshot.microphones
                            .filter((device) => device.deviceId)
                            .map((device, index) => (
                              <SelectItem key={device.deviceId} value={device.deviceId}>
                                {device.label || t('microphoneNumber', { number: index + 1 })}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mb-2 flex h-8 min-w-0 items-center text-[11px] leading-4 text-muted-foreground">
                    {hasCapture || completed ? (
                      <p className="flex min-w-0 items-center gap-2">
                        <Monitor className="size-3.5 shrink-0" />
                        <span className="truncate" title={snapshot.sourceLabel || undefined}>
                          {snapshot.sourceLabel || t('sharedScreen')}
                        </span>
                      </p>
                    ) : (
                      <p>
                        {snapshot.fileName
                          ? snapshot.audioInputs.pc
                            ? snapshot.audioInputs.mic
                              ? t('setupBoth')
                              : t('setupPc')
                            : snapshot.audioInputs.mic
                              ? t('setupMic')
                              : t('setupSilent')
                          : t('setupAfterSave')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={currentStep === 2 ? 'default' : 'outline'}
                    onClick={() => void session.prepareCapture()}
                    disabled={!canConfigure || !snapshot.fileName || Boolean(unsupported)}
                    className="h-10 w-full text-xs"
                  >
                    <MonitorUp className="size-4" />
                    {hasCapture || completed ? t('reselectScreen') : t('prepareScreen')}
                  </Button>
                </SetupStep>

                <SetupStep
                  number={3}
                  title={t('record')}
                  complete={completed}
                  current={currentStep === 3}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p
                      aria-label={t('recordingTime')}
                      className="font-mono text-[30px] leading-none tracking-[-1.5px] tabular-nums"
                    >
                      {duration(snapshot.elapsedMs)}
                    </p>
                    <span
                      role="status"
                      aria-live="polite"
                      className={cn(
                        'flex items-center gap-1.5 text-[11px] text-muted-foreground',
                        phase === 'idle' && 'sr-only',
                      )}
                    >
                      {recording && (
                        <span
                          aria-hidden
                          className="recording-pulse size-1.5 rounded-full bg-red-500"
                        />
                      )}
                      {t(phaseLabels[phase])}
                    </span>
                  </div>
                  {completed ? (
                    <Button onClick={() => session.reset()} className="h-11 w-full text-xs">
                      <RefreshCw className="size-4" />
                      {t('newRecording')}
                    </Button>
                  ) : recording ? (
                    <Button
                      variant="destructive"
                      onClick={() => void session.stop()}
                      className="h-11 w-full text-xs"
                    >
                      <CircleStop className="size-4" />
                      {t('stopSave')}
                    </Button>
                  ) : finalizing ? (
                    <Button disabled className="h-11 w-full text-xs">
                      <LoaderCircle className="size-4 animate-spin" />
                      {t('saving')}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void session.start()}
                      disabled={phase !== 'ready' || Boolean(unsupported)}
                      className="h-11 w-full text-xs"
                    >
                      <span className="size-2 rounded-full bg-current" />
                      {t('startRecording')}
                    </Button>
                  )}
                </SetupStep>
              </ol>
            </Card>
          </section>

          <section aria-label={t('recordingPreview')} className="min-w-0 lg:sticky lg:top-6">
            <Card className="gap-0 overflow-hidden py-0 shadow-xs">
              <div className="bg-zinc-950 text-zinc-100">
                <div className="flex h-12 items-center justify-between gap-3 border-b border-white/10 px-5">
                  <h2 className="flex items-center gap-2 text-xs font-medium">
                    <Monitor className="size-3.5 text-zinc-400" />
                    {t('preview')}
                  </h2>
                  <span className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        hasCapture ? 'bg-zinc-100' : 'bg-zinc-600',
                      )}
                    />
                    {hasCapture
                      ? t('screenSharing')
                      : completed
                        ? t('recordingEnded')
                        : t('notSelected')}
                  </span>
                </div>
                <div className="preview-stage relative flex h-[260px] w-full items-center justify-center overflow-hidden sm:aspect-video sm:h-auto lg:aspect-auto lg:h-[340px]">
                  {snapshot.preview ? (
                    <Preview stream={snapshot.preview} />
                  ) : completed ? (
                    <div className="relative px-8 py-10 text-center">
                      <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-xl border border-white/15 bg-zinc-900">
                        <CheckCheck className="size-6 text-zinc-100" />
                      </div>
                      <h3 className="text-base font-medium">{t('recordingSaved')}</h3>
                      <p className="mt-3 max-w-sm break-all text-xs leading-relaxed text-zinc-300">
                        {snapshot.fileName}
                      </p>
                      <p className="mt-2 text-xs text-zinc-400">{t('savedLocationHint')}</p>
                    </div>
                  ) : (
                    <div className="relative px-6 py-10 text-center">
                      <div
                        aria-hidden
                        className="mx-auto mb-6 flex size-14 items-center justify-center rounded-xl border border-white/15 bg-zinc-900 shadow-[0_0_0_6px_#ffffff03]"
                      >
                        <Monitor className="size-6 text-zinc-300" strokeWidth={1.5} />
                      </div>
                      <p className="text-sm font-medium tracking-tight">{t('previewEmpty')}</p>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">{t('previewHint')}</p>
                    </div>
                  )}
                  {recording && (
                    <div className="absolute left-4 top-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/70 px-3 py-1.5 font-mono text-[11px] tracking-wider">
                      <span className="recording-pulse size-1.5 rounded-full bg-red-500" />
                      REC
                    </div>
                  )}
                  {finalizing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/95">
                      <LoaderCircle className="size-7 animate-spin text-zinc-300" />
                      <p className="text-sm font-medium">{t('savingRecording')}</p>
                      <p className="text-xs text-zinc-400">{t('keepOpenSaving')}</p>
                    </div>
                  )}
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3 border-t border-white/10 px-5 py-2 text-[11px] text-zinc-400">
                  <span className="flex min-w-0 items-center gap-2">
                    <Monitor className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {snapshot.sourceLabel ||
                        t(hasCapture || completed ? 'sharedScreen' : 'noSharedScreen')}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-sm border-white/15 px-1.5 py-0 font-mono text-[10px] font-normal text-zinc-400"
                  >
                    {formatLabel}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 text-[11px] text-muted-foreground">
                <span>
                  {t('written')}{' '}
                  <span className="ml-1 font-mono text-foreground">
                    {size(snapshot.writtenBytes)}
                  </span>
                </span>
                <span>
                  {t('pending')}{' '}
                  <span className="ml-1 font-mono text-foreground">
                    {size(snapshot.pendingBytes)}
                  </span>
                </span>
                <span className="font-mono text-[10px]">
                  {t('maximum')}
                  {RESOLUTIONS[snapshot.settings.resolution].label} / {snapshot.settings.frameRate}
                  fps · {snapshot.settings.videoBitsPerSecond / 1_000_000}Mbps
                </span>
              </div>
            </Card>
            <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t('keepOpenRecording')}
            </p>
            <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              {t('localOnly')}
            </p>
          </section>
        </div>
        <footer className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t pt-5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HardDrive className="size-3" />
            Chrome for Mac & Windows
          </span>
        </footer>
      </main>
    </div>
  )
}
