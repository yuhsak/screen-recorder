import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, createServer } from 'vite'
import { googleAnalytics } from './google-analytics.ts'

const template = '<!doctype html><html><head><title>Test</title></head><body></body></html>'
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'screen-recorder-analytics-'))
  await writeFile(join(root, 'index.html'), template)
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function buildHtml(id?: string): Promise<string> {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [googleAnalytics(id)],
    build: { write: false },
  })
  if (Array.isArray(result) || !('output' in result)) throw new Error('Unexpected build output')
  const html = result.output.find((asset) => asset.fileName === 'index.html')
  if (html?.type !== 'asset') throw new Error('Missing HTML output')
  return String(html.source)
}

describe('Google Analytics build integration', () => {
  it('loads the tag asynchronously and queues one configuration command', async () => {
    const html = await buildHtml(' G-TEST123456 ')
    expect(
      html.match(/src="https:\/\/www.googletagmanager.com\/gtag\/js\?id=G-TEST123456"/g),
    ).toHaveLength(1)
    expect(html).toMatch(/<script[^>]*async[^>]*src="https:\/\/www.googletagmanager.com/)
    const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(inline).toBeDefined()
    const context = { dataLayer: [] as IArguments[], window: {} }
    context.window = context
    // Execute only our generated initialization, without loading Google or sending events.
    runInNewContext(inline!, context)
    const commands = context.dataLayer.map((args) => Array.from(args))
    expect(commands).toHaveLength(2)
    expect(commands[0][0]).toBe('js')
    expect(commands[1]).toEqual(['config', 'G-TEST123456'])
  })

  it.each([undefined, '', '   '])('omits analytics when the ID is unset: %s', async (id) => {
    const html = await buildHtml(id)
    expect(html).not.toContain('googletagmanager.com')
    expect(html).not.toContain('dataLayer')
  })

  it.each(['UA-123456-1', "G-TEST');</script>"])(
    'rejects an invalid measurement ID: %s',
    async (id) => {
      await expect(buildHtml(id)).rejects.toThrow('GA_MEASUREMENT_ID')
    },
  )

  it('omits analytics in development even when an ID is supplied', async () => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [googleAnalytics('G-TEST123456')],
      server: { middlewareMode: true, watch: null, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    try {
      const html = await server.transformIndexHtml('/', template)
      expect(html).not.toContain('googletagmanager.com')
      expect(html).not.toContain('dataLayer')
    } finally {
      await server.close()
    }
  })
})
