import { useEffect, useRef } from 'react'
import { openPrintManager } from '../lib/printManager'
import { buildBarcodeLabelHtml, parseLabelPrice } from '../lib/barcodeLabel'
import { loadLabelPrintConfig } from '../lib/labelSettings'
import { showToast } from '../lib/toast'

interface Props {
  code: string
  nom: string
  prix: number
  productRef?: string
  onClose: () => void
}

/** Opens PrintManagerModal for a barcode label (Gainscha-style settings). */
export default function BarcodeLabelPrintDialog({
  code,
  nom,
  prix,
  productRef = '',
  onClose,
}: Props) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const openedRef = useRef(false)

  const labelPrix = parseLabelPrice(prix)

  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true

    void (async () => {
      const cfg = await loadLabelPrintConfig()
      const html = buildBarcodeLabelHtml(
        code.trim(),
        nom.trim() || productRef || 'Produit',
        labelPrix,
        productRef,
        cfg,
      )
      const ok = openPrintManager({
        html,
        printKind: 'label',
        settingsKey: 'impression_printer_label',
        defaultPageSize: '40x20mm',
        labelConfig: cfg,
        labelSource: {
          code: code.trim(),
          nom: nom.trim() || productRef || 'Produit',
          prix: labelPrix,
          productRef,
        },
      })
      if (!ok) showToast('error', 'Impression indisponible')
      window.setTimeout(() => onCloseRef.current(), 0)
    })()
  }, [code, nom, labelPrix, productRef])

  return null
}
