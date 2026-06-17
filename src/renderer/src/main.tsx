import './styles/globals.css'
// Must be imported before App so window.api is set before any module captures it
import './mockApi'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// ── Global error guards — prevent blank screen from uncaught errors ────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[SMLPOS] Unhandled promise rejection:', e.reason)
  e.preventDefault() // Stops Electron renderer from going blank on rejected promise
})

window.addEventListener('error', (e) => {
  console.error('[SMLPOS] Uncaught error:', e.error ?? e.message)
})

function isElectronRuntime() {
  return navigator.userAgent.toLowerCase().includes('electron')
}

function MissingElectronApi() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface p-8 text-center">
      <h1 className="text-xl font-bold text-text-primary">API Electron indisponible</h1>
      <p className="max-w-md text-sm text-text-secondary">
        Le preload Electron n'a pas expose window.api. Verifiez le build preload et relancez l'application.
      </p>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  isElectronRuntime() && !window.api ? (
    <MissingElectronApi />
  ) : (
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
)
