import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import * as PELibrary from 'pe-library'
import * as ResEdit from 'resedit'

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

  const version = context.packager.appInfo.version
  const productName = context.packager.appInfo.productName
  const companyName = context.packager.appInfo.companyName ?? 'SMLPOS'
  const copyright = context.packager.appInfo.copyright ?? 'Copyright © 2026 SMLPOS'

  const data = readFileSync(exePath)
  const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true })
  const res = PELibrary.NtExecutableResource.from(exe)
  const iconFile = ResEdit.Data.IconFile.from(readFileSync(iconPath))
  const iconItems = iconFile.icons.map((item) => item.data)

  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  if (iconGroups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconItems)
  } else {
    for (const group of iconGroups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        group.id,
        group.lang,
        iconItems
      )
    }
  }

  const versionParts = version.split('.').map((part) => parseInt(part, 10) || 0)
  while (versionParts.length < 4) versionParts.push(0)

  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries)
  if (viList.length > 0) {
    const vi = viList[0]
    vi.setFileVersion(...versionParts, 1033)
    vi.setProductVersion(...versionParts, 1033)
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: productName,
        ProductName: productName,
        CompanyName: companyName,
        LegalCopyright: copyright,
      }
    )
    vi.outputToResourceEntries(res.entries)
  }

  res.outputResource(exe)
  writeFileSync(exePath, Buffer.from(exe.generate()))

  console.log(`[after-pack] Embedded SMLPOS icon in ${exePath} (${iconGroups.length || 1} icon group(s))`)
}
