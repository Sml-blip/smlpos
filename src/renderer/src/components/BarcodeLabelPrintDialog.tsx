import { useEffect, useMemo, useRef } from 'react'
import { openPrintManager } from '../lib/printManager'
import { buildBarcodeLabelHtml, parseLabelPrice } from '../lib/barcodeLabel'
import { showToast } from '../lib/toast'

interface Props {
  code: string
  nom: string
  prix: number
  /** Product reference — must NOT be named `ref` (React reserved prop). */
  productRef?: string
  onClose: () => void
}

/** Opens PrintManagerModal for a 40×20 mm barcode label. */
export default function BarcodeLabelPrintDialog({
  code,
  nom,
  prix,
  productRef = '',
  onClose,
}: Props) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const labelPrix = parseLabelPrice(prix)
  const documentHtml = useMemo(
    () => buildBarcodeLabelHtml(
      code.trim(),
      nom.trim() || productRef || 'Produit',
      labelPrix,
      productRef,
    ),
    [code, nom, labelPrix, productRef],
  )

  useEffect(() => {
    const ok = openPrintManager({
      html: documentHtml,
      defaultPageSize: '40x20mm',
      settingsKey: 'impression_printer_ticket',
    })
    if (!ok) showToast('error', 'Impression indisponible')
    const t = window.setTimeout(() => onCloseRef.current(), 0)
    return () => window.clearTimeout(t)
  }, [documentHtml])

  return null
}
