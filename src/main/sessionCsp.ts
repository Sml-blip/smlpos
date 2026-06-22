import { session } from 'electron'

const CSP_DEV_CONNECT = [
  "'self'",
  'http://localhost:*',
  'ws://localhost:*',
  'https://*.supabase.co',
  'wss://*.supabase.co',
  'https://api.github.com',
  'https://github.com',
  'https://releases.github.com',
].join(' ')

const CSP_PROD_CONNECT = [
  "'self'",
  'https://*.supabase.co',
  'wss://*.supabase.co',
  'https://api.github.com',
  'https://github.com',
  'https://releases.github.com',
].join(' ')

/** Allow Supabase + GitHub releases from renderer (fixes Failed to fetch under CSP). */
export function setupSessionCsp(isDev: boolean): void {
  const connectSrc = isDev ? CSP_DEV_CONNECT : CSP_PROD_CONNECT
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src ${connectSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    headers['Content-Security-Policy'] = [csp]
    callback({ responseHeaders: headers })
  })
}

export const RENDERER_CSP_META = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com https://github.com https://releases.github.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https: blob:",
].join('; ')
