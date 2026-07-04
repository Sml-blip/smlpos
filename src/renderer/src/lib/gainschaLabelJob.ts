import { pickLabelBarcodeValue } from './barcode'
import { clampLayout, printableArea } from './labelLayout'
import type { LabelPrintConfig } from './printManager'
import { parseLabelPrice } from './barcodeLabel'

export interface GainschaPrintJobPayload {
  connection: 'driver' | 'usb'
  printerName?: string
  usbDevice?: string
  widthMm: number
  heightMm: number
  stripLeftMm: number
  stripRightMm: number
  stripTopMm: number
  stripBottomMm: number
  rotationDeg: 0 | 180
  dpi: number
  copies: number
  showBarcodeText: boolean
  elements: {
    name: { x: number; y: number; w: number; h: number; visible: boolean; text: string }
    barcode: { x: number; y: number; w: number; h: number; visible: boolean; value: string; displayText: string }
    price: { x: number; y: number; w: number; h: number; visible: boolean; text: string }
  }
}

export function buildGainschaPrintJob(
  cfg: LabelPrintConfig,
  source: { code: string; nom: string; prix: number; productRef?: string },
  options: {
    printerName: string
    copies: number
    connection?: 'driver' | 'usb'
    usbDevice?: string
  },
): GainschaPrintJobPayload {
  const margins = printableArea(cfg)
  const layout = clampLayout(cfg.layout, margins.contentW, margins.contentH)
  const displayName = (source.nom || source.productRef || 'Produit').trim()
  const priceStr = `${parseLabelPrice(source.prix).toFixed(3)} DT`
  const barcodeValue = pickLabelBarcodeValue(source.code, source.productRef)

  return {
    connection: options.connection ?? cfg.labelConnection ?? 'driver',
    printerName: options.printerName,
    usbDevice: options.usbDevice ?? cfg.usbDevice,
    widthMm: cfg.widthMm,
    heightMm: cfg.heightMm,
    stripLeftMm: margins.stripLeftMm,
    stripRightMm: margins.stripRightMm,
    stripTopMm: margins.stripTopMm,
    stripBottomMm: margins.stripBottomMm,
    rotationDeg: cfg.rotationDeg,
    dpi: cfg.dpi,
    copies: options.copies,
    showBarcodeText: layout.showBarcodeText,
    elements: {
      name: {
        x: layout.name.x,
        y: layout.name.y,
        w: layout.name.w,
        h: layout.name.h,
        visible: layout.name.visible,
        text: displayName,
      },
      barcode: {
        x: layout.barcode.x,
        y: layout.barcode.y,
        w: layout.barcode.w,
        h: layout.barcode.h,
        visible: layout.barcode.visible,
        value: barcodeValue,
        displayText: barcodeValue,
      },
      price: {
        x: layout.price.x,
        y: layout.price.y,
        w: layout.price.w,
        h: layout.price.h,
        visible: layout.price.visible,
        text: priceStr,
      },
    },
  }
}
