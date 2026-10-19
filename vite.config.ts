import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { localizedPages } from './scripts/localized-pages.ts'
import { googleAnalytics } from './scripts/google-analytics.ts'

// https://vite.dev/config/
export default defineConfig({
  base: '/', // Served at the root of screen-recorder.ysk.im.
  plugins: [
    react(),
    tailwindcss(),
    googleAnalytics(process.env.GA_MEASUREMENT_ID),
    localizedPages(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
