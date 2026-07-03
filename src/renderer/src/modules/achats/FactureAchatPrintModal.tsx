import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Printer, Edit2, X } from 'lucide-react'
import InvoicePrintTemplate, { type InvoiceCompanySettings, type InvoiceDocData, type InvoiceLineData } from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'
import PinUnlockModal from '../../components/PinUnlockModal'
import InvoiceEditModal from '../../components/InvoiceEditModal'
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
  const [showPrint, setShowPrint] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [statutPaiement, setStatutPaiement] = useState('')

  const reload = () => {
    if (!factureId) return
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
        setStatutPaiement(String(facture?.statut_paiement ?? ''))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!factureId || preview) return
    reload()
  }, [factureId, preview]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !doc) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140]">
        <RefreshCw size={24} className="animate-spin text-white" />
      </div>
    )
  }

  const canEdit = !!factureId && statutPaiement !== 'BROUILLON' && statutPaiement !== 'ANNULE'

  if (showPrint) {
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
        onClose={() => { setShowPrint(false); onClose() }}
      />
    )
  }

  if (showPin && factureId) {
    return (
      <PinUnlockModal
        title={`Modifier ${doc.numero}`}
        onCancel={() => setShowPin(false)}
        onUnlocked={() => { setShowPin(false); setShowEdit(true) }}
      />
    )
  }

  if (showEdit && factureId) {
    return (
      <InvoiceEditModal
        mode="achat"
        documentId={factureId}
        onClose={() => setShowEdit(false)}
        onSaved={reload}
      />
    )
  }

  if (preview) {
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm">{doc.numero}</h3>
          <button type="button" onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-muted">Fournisseur</span><span>{doc.client_nom || '—'}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">Total TTC</span><span className="font-price font-bold">{doc.total_ttc.toFixed(3)} DT</span></div>
        </div>
        <div className="flex flex-col gap-2 px-5 pb-5">
          <button type="button" onClick={() => setShowPrint(true)}
            className="w-full flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 font-bold py-2.5 rounded-xl text-sm">
            <Printer size={14} /> Imprimer
          </button>
          {canEdit && (
            <button type="button" onClick={() => setShowPin(true)}
              className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">
              <Edit2 size={14} /> Modifier
            </button>
          )}
          <button type="button" onClick={onClose} className="w-full text-text-secondary py-2 text-sm">Fermer</button>
        </div>
      </div>
    </div>
  )
}
