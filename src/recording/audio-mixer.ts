/** The graph only feeds a MediaStreamDestination, never the speaker destination. */
export class AudioMixer {
  readonly destination: MediaStreamAudioDestinationNode
  private readonly pcSource: MediaStreamAudioSourceNode | undefined
  private micSource: MediaStreamAudioSourceNode | undefined
  private readonly pcGain: GainNode
  private readonly micGain: GainNode
  private readonly compressor: DynamicsCompressorNode
  private readonly outputGain: GainNode
  private readonly pcMeter: AnalyserNode
  private readonly micMeter: AnalyserNode
  private readonly samples = new Float32Array(256)

  constructor(
    private readonly context: AudioContext,
    pc: MediaStream | undefined,
    mic: MediaStream | undefined,
  ) {
    this.destination = context.createMediaStreamDestination()
    this.pcSource = pc ? context.createMediaStreamSource(pc) : undefined
    this.micSource = mic ? context.createMediaStreamSource(mic) : undefined
    this.pcGain = new GainNode(context, { gain: 0.5 })
    this.micGain = new GainNode(context, { gain: 0.5 })
    this.outputGain = new GainNode(context, { gain: 0.8 })
    this.compressor = new DynamicsCompressorNode(context, {
      threshold: -12,
      knee: 6,
      ratio: 8,
      attack: 0.003,
      release: 0.25,
    })
    this.pcMeter = new AnalyserNode(context, { fftSize: 256 })
    this.micMeter = new AnalyserNode(context, { fftSize: 256 })
    this.pcSource?.connect(this.pcMeter)
    this.pcSource?.connect(this.pcGain).connect(this.compressor)
    this.connectMicrophone()
    this.compressor.connect(this.outputGain).connect(this.destination)
  }

  replaceMicrophone(stream: MediaStream): void {
    const nextSource = this.context.createMediaStreamSource(stream)
    this.micSource?.disconnect()
    this.micSource = nextSource
    this.connectMicrophone()
  }

  levels(): { pc: number; mic: number } {
    return {
      pc: this.pcSource ? this.level(this.pcMeter) : 0,
      mic: this.micSource ? this.level(this.micMeter) : 0,
    }
  }

  release(): void {
    for (const node of [
      this.pcSource,
      this.micSource,
      this.pcGain,
      this.micGain,
      this.compressor,
      this.outputGain,
      this.pcMeter,
      this.micMeter,
    ])
      node?.disconnect()
    this.destination.stream.getTracks().forEach((track) => track.stop())
  }

  private connectMicrophone(): void {
    this.micSource?.connect(this.micMeter)
    this.micSource?.connect(this.micGain)
    this.micGain.connect(this.compressor)
  }

  private level(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.samples)
    const rms = Math.sqrt(
      this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length,
    )
    // A dB scale keeps normal speech visible, without claiming a calibrated SPL.
    return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60))
  }
}
