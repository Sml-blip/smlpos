import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Document, LigneDocument } from '../../lib/types'
import { normalizeInvoiceLine, applyTotalsToDoc } from '../../lib/invoiceLineCalc'
import type { InvoiceLineData } from '../../components/InvoicePrintTemplate'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'

const api = window.api

interface Props {
  doc: Document
  onClose: () => void
}

export default function DocumentPrintModal({ doc, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const [lignes, setLignes] = useState<LigneDocument[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const settingsPromise = (doc.layout_snapshot
      ? Promise.resolve(JSON.parse(doc.layout_snapshot) as Record<string, string>)
      : api.settingsGetAll() as Promise<Record<string, string>>
    )
    Promise.all([
      api.documentsGetLignes(doc.id) as Promise<LigneDocument[]>,
      settingsPromise,
    ]).then(([l, s]) => {
      setLignes(l || [])
      setSettings(s || {})
    }).finally(() => setLoading(false))
  }, [doc.id, doc.layout_snapshot])

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
    numero: doc.numero,
    type_document: doc.type_document,
    client_nom: doc.client_nom,
    client_tel: doc.client_tel,
    client_adresse: doc.client_adresse,
    client_matricule: doc.client_matricule,
    total_ht: doc.total_ht,
    total_tva: doc.total_tva,
    total_ttc: doc.total_ttc,
    statut_paiement: doc.statut_paiement,
    date_echeance: doc.date_echeance,
    created_at: doc.created_at,
    timbre: doc.timbre,
    total_remise: doc.total_remise,
    exo: doc.exo,
    net_a_payer: doc.net_a_payer,
  }, mappedLignes)

  return (
    <PrintDialog
      title={`Impression — ${doc.numero}`}
      subtitle={`${doc.client_nom || 'Client non spécifié'} · ${new Date(doc.created_at).toLocaleDateString('fr-FR')}`}
      getPrintHtml={() => printRef.current?.innerHTML ?? ''}
      preview={
        <div ref={printRef}>
          <InvoicePrintTemplate
            doc={printDoc}
            lignes={mappedLignes}
            settings={settings}
          />
        </div>
      }
      pageSize="A4"
      settingsKey="impression_printer_a4"
      onClose={onClose}
    />
  )
}
