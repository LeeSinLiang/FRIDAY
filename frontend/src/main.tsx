import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

document.documentElement.dataset.build = import.meta.env.VITE_FRIDAY_BUILD_ID || 'local'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
