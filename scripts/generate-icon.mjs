import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resourcesDir = join(root, 'resources')
mkdirSync(resourcesDir, { recursive: true })

const sharp = (await import('sharp')).default
const svgPath = join(root, 'src/renderer/src/assets/logo.svg')
const pngPath = join(resourcesDir, 'icon.png')
const icoPath = join(resourcesDir, 'icon.ico')

await sharp(readFileSync(svgPath))
  .resize(512, 512, { fit: 'contain', background: '#fab418' })
  .png()
  .toFile(pngPath)

const pngBuf = readFileSync(pngPath)
const toIco = (await import('to-ico')).default
const icoBuf = await toIco(pngBuf, { resize: true, sizes: [16, 24, 32, 48, 64, 128, 256] })
writeFileSync(icoPath, icoBuf)

console.log(`Generated ${pngPath} and ${icoPath}`)
