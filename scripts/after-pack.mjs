import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Force SMLPOS icon into the Windows exe when signAndEditExecutable is disabled. */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const iconPath = join(root, 'resources', 'icon.ico')
  if (!existsSync(iconPath)) {
    throw new Error(`Missing Windows icon: ${iconPath}`)
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = join(context.appOutDir, exeName)
  if (!existsSync(exePath)) {
    throw new Error(`Missing packaged executable: ${exePath}`)
  }

  const { rcedit } = await import('rcedit')
  const version = context.packager.appInfo.version

  await rcedit(exePath, {
    icon: iconPath,
    'product-version': version,
    'file-version': version,
    'version-string': {
      ProductName: context.packager.appInfo.productName,
      FileDescription: context.packager.appInfo.productName,
      CompanyName: context.packager.appInfo.companyName ?? 'SMLPOS',
      LegalCopyright: context.packager.appInfo.copyright ?? 'Copyright © 2026 SMLPOS',
    },
  })

  console.log(`[after-pack] Embedded SMLPOS icon in ${exePath}`)
}
