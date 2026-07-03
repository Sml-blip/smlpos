import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Printer, Edit2, X } from 'lucide-react'
import type { Document, LigneDocument } from '../../lib/types'
import { normalizeInvoiceLine, applyTotalsToDoc } from '../../lib/invoiceLineCalc'
import type { InvoiceLineData } from '../../components/InvoicePrintTemplate'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'
import PinUnlockModal from '../../components/PinUnlockModal'
import InvoiceEditModal from '../../components/InvoiceEditModal'

const api = window.api

const EDITABLE_TYPES = new Set(['FACTURE_VENTE', 'DEVIS', 'BON_LIVRAISON', 'FACTURE_JOURNALIERE_F'])
const BLOCKED_STATUTS = new Set(['ANNULE', 'REVOQUE'])

interface Props {
  doc: Document
  onClose: () => void
}

export default function DocumentPrintModal({ doc, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const [lignes, setLignes] = useState<LigneDocument[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [showPrint, setShowPrint] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [docState, setDocState] = useState(doc)

  const loadDoc = () => {
    setLoading(true)
    const settingsPromise = (docState.layout_snapshot
      ? Promise.resolve(JSON.parse(docState.layout_snapshot) as Record<string, string>)
      : api.settingsGetAll() as Promise<Record<string, string>>
    )
    Promise.all([
      api.documentsGetLignes(docState.id) as Promise<LigneDocument[]>,
      settingsPromise,
      api.documentsGet?.(docState.id) as Promise<Document | null>,
    ]).then(([l, s, fresh]) => {
      setLignes(l || [])
      setSettings(s || {})
      if (fresh) setDocState(fresh)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadDoc() }, [docState.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140]">
        <RefreshCw size={24} className="animate-spin text-white" />
      </div>
    )
  }

  const mappedLignes: InvoiceLineData[] = lignes.map(l => normalizeInvoiceLine({
    id: l.id,
    designation: l.designation,
    quantite: l.quantite,
    prix_unitaire: l.prix_unitaire,
    remise_pct: l.remise_pct,
    tva_taux: l.tva_taux,
    total_ht: l.total_ht,
    total_tva: l.total_tva,
    total_ttc: l.total_ttc,
    reference: l.reference ?? null,
    numero_serie: l.numero_serie ?? null,
  }))

  const printDoc = applyTotalsToDoc({
    numero: docState.numero,
    type_document: docState.type_document,
    client_nom: docState.client_nom,
    client_tel: docState.client_tel,
    client_adresse: docState.client_adresse,
    client_matricule: docState.client_matricule,
    total_ht: docState.total_ht,
    total_tva: docState.total_tva,
    total_ttc: docState.total_ttc,
    statut_paiement: docState.statut_paiement,
    date_echeance: docState.date_echeance,
    created_at: docState.created_at,
    timbre: docState.timbre,
    total_remise: docState.total_remise,
    exo: docState.exo,
    net_a_payer: (docState as Document & { net_a_payer?: number }).net_a_payer,
    facture_origine_numero: docState.facture_origine_numero ?? undefined,
  }, mappedLignes)

  const canEdit = EDITABLE_TYPES.has(docState.type_document) && !BLOCKED_STATUTS.has(docState.statut) && docState.type_document !== 'AVOIR'

  if (showPrint) {
    return (
      <PrintDialog
        title={`Impression — ${docState.numero}`}
        subtitle={`${docState.client_nom || 'Client non spécifié'} · ${new Date(docState.created_at).toLocaleDateString('fr-FR')}`}
        getPrintHtml={() => printRef.current?.innerHTML ?? ''}
        preview={
          <div ref={printRef}>
            <InvoicePrintTemplate doc={printDoc} lignes={mappedLignes} settings={settings} />
          </div>
        }
        pageSize="A4"
        settingsKey="impression_printer_a4"
        onClose={() => { setShowPrint(false); onClose() }}
      />
    )
  }

  if (showPin) {
    return (
      <PinUnlockModal
        title={`Modifier ${docState.numero}`}
        onCancel={() => setShowPin(false)}
        onUnlocked={() => { setShowPin(false); setShowEdit(true) }}
      />
    )
  }

  if (showEdit) {
    return (
      <InvoiceEditModal
        mode="vente"
        documentId={docState.id}
        onClose={() => setShowEdit(false)}
        onSaved={loadDoc}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm">{docState.numero}</h3>
          <button type="button" onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-muted">Client</span><span>{docState.client_nom || '—'}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">Total TTC</span><span className="font-price font-bold">{docState.total_ttc.toFixed(3)} DT</span></div>
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
