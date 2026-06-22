import { protocol } from 'electron'
import { join } from 'path'

/** Must run before app.ready — enables fetch() from renderer when loaded via app:// */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

const APP_PROTOCOL = 'app'
const APP_HOST = 'local'

export function getAppIndexUrl(): string {
  return `${APP_PROTOCOL}://${APP_HOST}/index.html`
}

/** Register file handler — call once inside app.whenReady(), before createWindow(). */
export function registerAppProtocol(rendererDir: string): void {
  protocol.registerFileProtocol(APP_PROTOCOL, (request, callback) => {
    try {
      const url = new URL(request.url)
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!rel) rel = 'index.html'
      callback({ path: join(rendererDir, rel) })
    } catch {
      callback({ error: -2 })
    }
  })
}
