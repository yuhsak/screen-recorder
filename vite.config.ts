import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { localizedPages } from './scripts/localized-pages.ts'

// https://vite.dev/config/
export default defineConfig({
  base: '/', // Served at the root of screen-recorder.ysk.im.
  plugins: [react(), tailwindcss(), localizedPages()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
