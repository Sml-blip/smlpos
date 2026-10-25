const tmp = process.env.SMLSEED_TMP || process.env.APPDATA || '/tmp'
export const app = {
  getPath: () => tmp + '/SMLPOS', isPackaged: true, getVersion: () => '1.9.1001',
  setPath() {}, on() {}, whenReady: () => new Promise(() => {}), getName: () => 'SMLPOS',
}
export const ipcMain = { handle() {} }
export const dialog = {}
export const safeStorage = { isEncryptionAvailable: () => false }
export const shell = {}
export const BrowserWindow = class {}
export default { app }
