import type { FileSink } from './types'

export const PENDING_LIMIT = 64 * 1024 * 1024

/** A single consumer preserves chunk order; pending includes the in-flight write. */
export class FileWriter {
  private tail: Promise<void> = Promise.resolve()
  private failure: unknown = null
  private failed = false
  private aborted = false
  private closing = false
  private finalization: Promise<void> | null = null
  private aborting: Promise<void> | null = null
  private pending = 0
  private written = 0
  private limitReported = false

  constructor(
    private readonly sink: FileSink,
    private readonly callbacks: {
      progress: (written: number, pending: number) => void
      limit: () => void
      error: (error: unknown) => void
    },
    private readonly limit = PENDING_LIMIT,
  ) {}

  enqueue(chunk: Blob): void {
    if (chunk.size === 0 || this.aborted || this.failed || this.closing) return
    this.pending += chunk.size
    this.report()
    this.tail = this.tail.then(async () => {
      try {
        if (!this.aborted && !this.failed) {
          await this.sink.write(chunk)
          this.written += chunk.size
        }
      } catch (error) {
        this.failure = error
        this.failed = true
        this.callbacks.error(error)
      } finally {
        this.pending -= chunk.size
        this.report()
      }
    })
    if (this.pending >= this.limit && !this.limitReported) {
      this.limitReported = true
      this.callbacks.limit()
    }
  }

  finalize(): Promise<void> {
    if (this.finalization) return this.finalization
    this.closing = true
    this.finalization = (async () => {
      await this.tail
      if (this.failed) throw this.failure
      if (this.aborted) throw new Error('File write was aborted')
      await this.sink.close()
    })()
    return this.finalization
  }

  abort(): Promise<void> {
    if (this.aborting) return this.aborting
    this.aborted = true
    // Do not wait for tail: the underlying writable may itself be failing.
    this.aborting = this.sink.abort().catch(() => undefined)
    return this.aborting
  }

  private report(): void {
    this.callbacks.progress(this.written, this.pending)
  }
}
