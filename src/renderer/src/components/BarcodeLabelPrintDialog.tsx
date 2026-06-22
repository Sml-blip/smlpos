import { useMemo } from 'react'
import PrintDialog from './PrintDialog'
import { buildBarcodeLabelHtml, parseLabelPrice } from '../lib/barcodeLabel'
import { formatPrice } from '../lib/utils'

interface Props {
  code: string
  nom: string
  prix: number
  ref?: string
  onClose: () => void
}

/** Preview + print dialog for 40×20 mm barcode labels (ticket printer). */
export default function BarcodeLabelPrintDialog({ code, nom, prix, ref = '', onClose }: Props) {
  const labelPrix = parseLabelPrice(prix)
  const documentHtml = useMemo(
    () => buildBarcodeLabelHtml(code.trim(), nom.trim() || ref || 'Produit', labelPrix, ref),
    [code, nom, labelPrix, ref],
  )

  return (
    <PrintDialog
      title="Étiquette code-barres"
      subtitle={`${nom || ref} · ${formatPrice(labelPrix)}`}
      documentHtml={documentHtml}
      pageSize="40x20mm"
      settingsKey="impression_printer_ticket"
      onClose={onClose}
    />
  )
}
