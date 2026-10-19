import type { Plugin } from 'vite'

export function googleAnalytics(measurementId: string | undefined): Plugin {
  const id = measurementId?.trim()
  return {
    name: 'google-analytics',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler() {
        if (!id) return []
        if (!/^G-[A-Z0-9]+$/.test(id)) {
          throw new Error('GA_MEASUREMENT_ID must be a GA4 measurement ID starting with G-')
        }
        return [
          {
            tag: 'script',
            attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
            injectTo: 'head',
          },
          {
            tag: 'script',
            children: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`,
            injectTo: 'head',
          },
        ]
      },
    },
  }
}
