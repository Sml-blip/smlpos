import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import InvoicePrintTemplate, { type InvoiceCompanySettings, type InvoiceDocData, type InvoiceLineData } from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'
import { mapDbFactureAchatToInvoice } from '../../lib/invoiceAchatMapper'

const api = window.api

interface Props {
  onClose: () => void
  factureId?: string
  preview?: {
    doc: InvoiceDocData
    lignes: InvoiceLineData[]
    settings?: InvoiceCompanySettings
  }
}

export default function FactureAchatPrintModal({ onClose, factureId, preview }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<InvoiceDocData | null>(preview?.doc ?? null)
  const [lignes, setLignes] = useState<InvoiceLineData[]>(preview?.lignes ?? [])
  const [settings, setSettings] = useState<InvoiceCompanySettings>(preview?.settings ?? {})
  const [loading, setLoading] = useState(!!factureId && !preview)

  useEffect(() => {
    if (!factureId || preview) return
    setLoading(true)
    Promise.all([
      api.facturesFournisseursGet?.(factureId) as Promise<Record<string, unknown>>,
      api.facturesFournisseursGetLignes?.(factureId) as Promise<Record<string, unknown>[]>,
      api.settingsGetAll() as Promise<Record<string, string>>,
    ])
      .then(([facture, rows, s]) => {
        const mapped = mapDbFactureAchatToInvoice(facture ?? {}, rows ?? [])
        setDoc(mapped.doc)
        setLignes(mapped.lignes)
        setSettings(s ?? {})
      })
      .finally(() => setLoading(false))
  }, [factureId, preview])

  if (loading || !doc) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140]">
        <RefreshCw size={24} className="animate-spin text-white" />
      </div>
    )
  }

  return (
    <PrintDialog
      title={`Impression — ${doc.numero}`}
      subtitle={`${doc.client_nom || 'Fournisseur'} · ${new Date(doc.created_at).toLocaleDateString('fr-FR')}`}
      getPrintHtml={() => printRef.current?.innerHTML ?? ''}
      preview={
        <div ref={printRef}>
          <InvoicePrintTemplate doc={doc} lignes={lignes} settings={settings} />
        </div>
      }
      pageSize="A4"
      settingsKey="impression_printer_a4"
      onClose={onClose}
    />
  )
}
