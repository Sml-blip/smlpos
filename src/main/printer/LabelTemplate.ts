export const PRINTER_DPI   = 203
export const MM            = (mm: number) => Math.round(mm * PRINTER_DPI / 25.4)

// ── Label dimensions ─────────────────────────────────────────────────────────
const W   = MM(40)      // 320 dots  — full label width
const H   = MM(19.9)    // 159 dots  — full label height
const SL  = MM(1.3)     // 10 dots   — left strip (non-printable)
const UW  = W - SL - MM(1.3)  // 300 dots — usable width

export const Label40x20 = {
  // Canvas size (dots = pixels at 203 DPI, 1:1 mapping)
  canvasW:   W,    // 320
  canvasH:   H,    // 159

  // Printer settings
  density:   12,   // 1–15, 12 = solid black
  speed:     2,    // 1 = slow/best, 14 = fast/low quality
  gapMm:     3,    // mm between labels

  // Element positions — all in dots, origin = top-left of canvas
  name: {
    x:       SL,
    y:       3,
    maxW:    UW,
    fontPt:  6,
    weight:  'bold'  as const,
    maxLines: 2,
  },
  barcode: {
    x:       SL,
    y:       MM(5.2),      // 42 dots from top
    w:       UW,
    barH:    MM(8),        // 64 dots — bars only, not including human-readable text
    narrow:  2,            // narrow bar width in dots
    wide:    4,            // wide bar width in dots
    textPt:  7,
  },
  price: {
    x:       SL,
    y:       H - MM(3.2), // 133 dots from top
    maxW:    UW,
    fontPt:  8.5,
    weight:  '900' as const,
  },
} as const

export interface LabelData {
  nom:       string   // full product name, never truncated
  codeBarre: string   // barcode value (CODE128)
  prix:      number   // selling price
}
