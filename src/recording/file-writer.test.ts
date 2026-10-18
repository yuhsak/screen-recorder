import { describe, it, expect, vi } from 'vitest'
import { FileWriter } from './file-writer'
import type { FileSink } from './types'
import { deferred, flush } from '../test/fakes'

function setup(limit?: number) {
  const sink: FileSink = {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  }
  const callbacks = { progress: vi.fn(), limit: vi.fn(), error: vi.fn() }
  return { sink, callbacks, writer: new FileWriter(sink, callbacks, limit) }
}

describe('FileWriter', () => {
  it('serializes writes and waits for all chunks before closing', async () => {
    const { writer, sink } = setup()
    const first = deferred()
    const contents: string[] = []
    vi.mocked(sink.write).mockImplementation(async (chunk) => {
      contents.push(await chunk.text())
      if (contents.length === 1) await first.promise
    })
    writer.enqueue(new Blob(['A']))
    writer.enqueue(new Blob(['B']))
    writer.enqueue(new Blob(['C']))
    const completion = writer.finalize()
    await flush()
    expect(contents).toEqual(['A'])
    expect(sink.close).not.toHaveBeenCalled()
    first.resolve()
    await completion
    expect(contents).toEqual(['A', 'B', 'C'])
    expect(sink.close).toHaveBeenCalledOnce()
  })

  it('counts in-flight bytes, signals the threshold once, and retains the final chunk', async () => {
    const { writer, sink, callbacks } = setup(4)
    const gate = deferred()
    vi.mocked(sink.write).mockImplementationOnce(() => gate.promise)
    writer.enqueue(new Blob(['AB']))
    await flush()
    writer.enqueue(new Blob(['CD']))
    writer.enqueue(new Blob(['E']))
    expect(callbacks.limit).toHaveBeenCalledOnce()
    expect(callbacks.progress).toHaveBeenLastCalledWith(0, 5)
    gate.resolve()
    await writer.finalize()
    expect(sink.write).toHaveBeenCalledTimes(3)
    expect(callbacks.progress).toHaveBeenLastCalledWith(5, 0)
  })

  it('fails finalization after a failed write and does not write later chunks', async () => {
    const { writer, sink, callbacks } = setup()
    const error = new Error('Disk full')
    vi.mocked(sink.write).mockRejectedValueOnce(error)
    writer.enqueue(new Blob(['first']))
    writer.enqueue(new Blob(['second']))
    await expect(writer.finalize()).rejects.toBe(error)
    expect(callbacks.error).toHaveBeenCalledWith(error)
    expect(sink.write).toHaveBeenCalledOnce()
    expect(sink.close).not.toHaveBeenCalled()
  })

  it('reports a close failure instead of successful completion', async () => {
    const { writer, sink } = setup()
    vi.mocked(sink.close).mockRejectedValue(new Error('Close failed'))
    writer.enqueue(new Blob(['data']))
    await expect(writer.finalize()).rejects.toThrow('Close failed')
  })

  it('aborts only once and never commits an aborted recording', async () => {
    const { writer, sink } = setup()
    writer.enqueue(new Blob(['data']))
    await Promise.all([writer.abort(), writer.abort()])
    await expect(writer.finalize()).rejects.toThrow('aborted')
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(sink.close).not.toHaveBeenCalled()
  })

  it('ignores empty chunks and shares the same finalization promise', async () => {
    const { writer, sink } = setup()
    writer.enqueue(new Blob([]))
    const result = writer.finalize()
    expect(writer.finalize()).toBe(result)
    await result
    expect(sink.write).not.toHaveBeenCalled()
    expect(sink.close).toHaveBeenCalledOnce()
  })
})
