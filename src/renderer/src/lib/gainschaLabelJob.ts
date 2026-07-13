import { pickLabelBarcodePayload } from './barcode'
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
    barcode: { x: number; y: number; w: number; h: number; visible: boolean; value: string; displayText: string; format: 'EAN13' | 'EAN8' | 'CODE128' }
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
  const compactSdkTemplate = cfg.widthMm <= 45 && cfg.heightMm <= 25
  const margins = compactSdkTemplate
    ? {
        stripLeftMm: 0.6,
        stripRightMm: 0.6,
        stripTopMm: 0.35,
        stripBottomMm: 0.35,
        contentW: Math.max(1, cfg.widthMm - 1.2),
        contentH: Math.max(1, cfg.heightMm - 0.7),
      }
    : printableArea(cfg)
  const layout = clampLayout(cfg.layout, margins.contentW, margins.contentH)
  const displayName = (source.nom || source.productRef || 'Produit').trim()
  const priceStr = `${parseLabelPrice(source.prix).toFixed(3)} DT`
  const barcode = pickLabelBarcodePayload(source.code, source.productRef)
  const sdkLayout = compactSdkTemplate
    ? {
        name: { x: 16.1, y: 0.45, w: Math.max(12, margins.contentW - 16.1), h: 4.2, visible: true },
        price: { x: 0.6, y: 0.45, w: 14.5, h: 4.2, visible: true },
        barcode: { x: 0.6, y: 5.65, w: Math.max(24, margins.contentW - 1.2), h: 12, visible: true },
        showBarcodeText: false,
      }
    : layout

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
    showBarcodeText: compactSdkTemplate ? false : layout.showBarcodeText,
    elements: {
      name: {
        x: sdkLayout.name.x,
        y: sdkLayout.name.y,
        w: sdkLayout.name.w,
        h: sdkLayout.name.h,
        visible: sdkLayout.name.visible,
        text: displayName,
      },
      barcode: {
        x: sdkLayout.barcode.x,
        y: sdkLayout.barcode.y,
        w: sdkLayout.barcode.w,
        h: sdkLayout.barcode.h,
        visible: sdkLayout.barcode.visible,
        value: barcode.value,
        displayText: barcode.value,
        format: barcode.format,
      },
      price: {
        x: sdkLayout.price.x,
        y: sdkLayout.price.y,
        w: sdkLayout.price.w,
        h: sdkLayout.price.h,
        visible: sdkLayout.price.visible,
        text: priceStr,
      },
    },
  }
}
