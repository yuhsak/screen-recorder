import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.tsx'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <App pageLocale={document.documentElement.lang === 'ja' ? 'ja' : 'en'} />
  </StrictMode>
)
if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)
