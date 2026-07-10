import JsBarcode from 'jsbarcode'
import { Label40x20, LabelData, PRINTER_DPI } from '../../../main/printer/LabelTemplate'

// pt → px at printer DPI (203 DPI = 2.819px/pt)
const pt = (size: number) => Math.round(size * PRINTER_DPI / 72)

export interface RenderedLabel {
  dataURL: string       // for <img> preview — exact pixels
  blob:    Blob         // for label-printer Image.create() — same pixels
}

export const renderLabel = async (data: LabelData): Promise<RenderedLabel> => {
  const T = Label40x20

  // ── Canvas at exact printer resolution ───────────────────────────────────
  const canvas    = document.createElement('canvas')
  canvas.width    = T.canvasW   // 320px = 320 dots at 203 DPI = 40mm exact
  canvas.height   = T.canvasH   // 159px = 159 dots at 203 DPI = 19.9mm exact
  const ctx       = canvas.getContext('2d')!

  // ── White background ──────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, T.canvasW, T.canvasH)
  ctx.fillStyle = '#000000'

  // ── Product name (word-wrapped, never truncated with "...") ───────────────
  const namePx = pt(T.name.fontPt)
  ctx.font         = `${T.name.weight} ${namePx}px Arial`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'top'

  const cx     = T.name.x + T.name.maxW / 2
  const lineH  = namePx + 2
  const words  = data.nom.split(' ')
  let line     = ''
  let y        = T.name.y
  let lines    = 0

  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > T.name.maxW && line) {
      ctx.fillText(line, cx, y)
      line  = word
      y    += lineH
      lines++
      if (lines >= T.name.maxLines - 1) {
        ctx.fillText(line + (words.indexOf(word) < words.length - 1 ? '..' : ''), cx, y)
        line = ''
        break
      }
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, cx, y)

  // ── Barcode via JsBarcode on offscreen canvas ─────────────────────────────
  const bcCanvas = document.createElement('canvas')
  JsBarcode(bcCanvas, data.codeBarre, {
    format:       'CODE128',
    width:        T.barcode.narrow,   // narrow bar = 2 dots
    height:       T.barcode.barH,     // 64 dots
    displayValue: true,
    fontSize:     pt(T.barcode.textPt),
    fontOptions:  'bold',
    textMargin:   2,
    margin:       0,
    background:   '#ffffff',
    lineColor:    '#000000',
  })

  // Scale to fill usable width exactly
  ctx.save()
  ctx.translate(T.barcode.x, T.barcode.y)
  ctx.scale(T.barcode.w / bcCanvas.width, 1)
  ctx.drawImage(bcCanvas, 0, 0)
  ctx.restore()

  // ── Price ─────────────────────────────────────────────────────────────────
  const pricePx = pt(T.price.fontPt)
  ctx.font         = `${T.price.weight} ${pricePx}px Arial`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${data.prix.toFixed(3)} DT`, T.price.x + T.price.maxW / 2, T.price.y)

  // ── Rotate 180° — Gainscha feeds labels upside down ──────────────────────
  const rotated   = document.createElement('canvas')
  rotated.width   = T.canvasW
  rotated.height  = T.canvasH
  const rCtx      = rotated.getContext('2d')!
  rCtx.translate(T.canvasW / 2, T.canvasH / 2)
  rCtx.rotate(Math.PI)
  rCtx.drawImage(canvas, -T.canvasW / 2, -T.canvasH / 2)

  // ── Export ────────────────────────────────────────────────────────────────
  const dataURL = rotated.toDataURL('image/png')

  // Convert dataURL → Blob for label-printer
  const blob = await new Promise<Blob>((resolve) => rotated.toBlob(b => resolve(b!), 'image/png'))

  return { dataURL, blob }
}
