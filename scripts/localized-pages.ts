import { createServer, type Plugin, type ResolvedConfig } from 'vite'

interface PageRenderer {
  renderPage(template: string, pathname: string): string
}

export function localizedPages(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'localized-pages',
    configResolved(resolved) {
      config = resolved
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, context) {
        if (!context.server) return html
        const { renderPage } = (await context.server.ssrLoadModule(
          '/src/entry-server.tsx',
        )) as PageRenderer
        const pathname = new URL(context.originalUrl ?? context.path, 'http://localhost').pathname
        return renderPage(html, pathname)
      },
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const index = bundle['index.html']
        if (!index || index.type !== 'asset' || typeof index.source !== 'string') {
          throw new Error('The client HTML template was not generated')
        }
        const template = index.source
        const server = await createServer({
          configFile: false,
          root: config.root,
          resolve: { alias: config.resolve.alias },
          server: { middlewareMode: true, watch: null, hmr: false, ws: false },
          optimizeDeps: { noDiscovery: true, include: [] },
          appType: 'custom',
        })
        try {
          const { renderPage } = (await server.ssrLoadModule(
            '/src/entry-server.tsx',
          )) as PageRenderer
          const { PAGE_PATHS } = (await server.ssrLoadModule('/src/i18n/routes.ts')) as {
            PAGE_PATHS: string[]
          }
          for (const path of PAGE_PATHS) {
            const source = renderPage(template, path)
            if (path === '/') index.source = source
            else this.emitFile({ type: 'asset', fileName: `${path.slice(1)}index.html`, source })
          }
        } finally {
          await server.close()
        }
      },
    },
  }
}
