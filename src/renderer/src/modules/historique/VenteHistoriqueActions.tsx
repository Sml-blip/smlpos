import { useState, useEffect } from 'react'
import type { Vente, LigneVente } from '../../lib/types'
import { generateId } from '../../lib/utils'
import { calcInvoiceLineFromTtcUnit, sumInvoiceLines } from '../../lib/invoiceLineCalc'
import { taxBucketsFromLines, documentCalculatesTva } from '../../lib/documentFromCart'
import { runAction, loadData } from '../../lib/apiCall'
import { printFullHtmlDocument } from '../../lib/nativePrint'
import { buildReceiptTicketHtml } from '../../lib/ticketHtml'
import { X, Printer, FileText, FileCheck } from 'lucide-react'
import DocumentPrintModal from './DocumentPrintModal'
import type { Document as DocType } from '../../lib/types'
import {
  canCreateDocumentFromLignes,
  documentAllowsNF,
  filterLignesForDocument,
} from '../../lib/documentProductRules'

const api = window.api

export function VenteTicketPrintModal({ vente, onClose }: { vente: Vente; onClose: () => void }) {
  const [lignes, setLignes] = useState<LigneVente[]>([])
  const ticketHtml = buildReceiptTicketHtml(vente, lignes)

  const handlePrint = async () => {
    await printFullHtmlDocument(ticketHtml, {
      pageSize: '58mm',
      settingsKey: 'impression_printer_ticket',
      printKind: 'ticket',
    })
  }

  useEffect(() => {
    loadData('Lignes', () => api.ventesGetLignes(vente.id) as Promise<LigneVente[]>, { silent: true }).then(r => {
      if (r) setLignes(r)
    })
  }, [vente.id])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-sm">Ticket {vente.numero}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="bg-gray-50 border border-border rounded-lg p-3 max-h-80 overflow-auto">
          <iframe
            title="Ticket preview"
            srcDoc={ticketHtml}
            className="bg-white border border-gray-200 rounded"
            style={{ width: 280, height: 430, display: 'block', margin: '0 auto' }}
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 bg-muted rounded-xl text-sm font-semibold">Fermer</button>
          <button onClick={() => void handlePrint()} className="flex-1 py-2 bg-accent-500 rounded-xl text-sm font-bold flex items-center justify-center gap-1">
            <Printer size={14} /> Imprimer
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConvertVenteDocModal({
  vente, onClose, onCreated, initialType = 'FACTURE_VENTE', forcePassenger = false,
}: {
  vente: Vente
  onClose: () => void
  onCreated: () => void
  initialType?: 'FACTURE_VENTE' | 'BON_LIVRAISON' | 'DEVIS'
  forcePassenger?: boolean
}) {
  const [type, setType] = useState<'FACTURE_VENTE' | 'BON_LIVRAISON' | 'DEVIS'>(initialType)
  const [loading, setLoading] = useState(false)
  const [lignes, setLignes] = useState<LigneVente[]>([])
  const [createdDoc, setCreatedDoc] = useState<DocType | null>(null)

  useEffect(() => {
    loadData('Lignes vente', () => api.ventesGetLignes(vente.id) as Promise<LigneVente[]>, { silent: true })
      .then(r => { if (r) setLignes(r) })
  }, [vente.id])

  const eligibleLignes = filterLignesForDocument(type, lignes)
  const nfLignes = lignes.filter(l => l.type_produit === 'NF')
  const fLignes = lignes.filter(l => l.type_produit === 'F')
  const canCreate = canCreateDocumentFromLignes(type, lignes)
  const nfOnDoc = documentAllowsNF(type)

  const handleCreate = async () => {
    if (!canCreate) return
    await runAction('Création document', async () => {
      const filtered = eligibleLignes
      if (!filtered.length) throw new Error('Aucune ligne éligible pour ce document')
      
      const docId = generateId()
      const calculateTva = documentCalculatesTva(type)
      const docLignes = filtered.map(l => {
        const rate = calculateTva ? ((l as any).tva_taux ?? 19.0) : 0
        const calc = calcInvoiceLineFromTtcUnit({
          quantite: l.quantite,
          prix_unitaire_ttc: l.prix_unitaire,
          remise_pct: l.remise_pct || 0,
          tva_taux: rate,
        })
        return {
          id: generateId(),
          document_id: docId,
          produit_id: l.produit_id || null,
          designation: l.designation,
          quantite: l.quantite,
          prix_unitaire: calc.prix_unitaire,
          remise_pct: l.remise_pct || 0,
          tva_taux: calc.tva_taux,
          total_ht: calc.total_ht,
          total_tva: calc.total_tva,
          total_ttc: calc.total_ttc,
          type_produit: l.type_produit,
          numero_serie: (l as any).numero_serie || null,
        }
      })

      const sums = sumInvoiceLines(docLignes)
      const tax = taxBucketsFromLines(docLignes)
      
      const lineRemiseTotal = filtered.reduce((s, l) => {
        const brut = l.quantite * l.prix_unitaire
        return s + brut * ((l.remise_pct || 0) / 100)
      }, 0)
      const remisePanier = Math.max(0, (vente.total_remises ?? 0) - lineRemiseTotal)
      const isFacture = type === 'FACTURE_VENTE' || type === 'FACTURE_JOURNALIERE_F'
      const timbre = isFacture ? 1.0 : 0.0
      const netPay = Math.max(0, sums.total_ttc + timbre - remisePanier)

      const year = new Date().getFullYear()
      const yy = String(year).slice(-2)
      const seqKey = type === 'DEVIS' ? `devis_sequence_${year}` : type === 'BON_LIVRAISON' ? `bl_vente_sequence_${year}` : `facture_vente_sequence_${year}`
      const prev = parseInt((await api.settingsGet(seqKey) as string) ?? '0') || 0
      const next = prev + 1
      await api.settingsSet(seqKey, String(next))
      const prefix = type === 'BON_LIVRAISON' ? 'BL' : type === 'DEVIS' ? 'DEV' : ''
      const numero = `${prefix}${yy}/#${String(next).padStart(5, '0')}`
      const now = new Date().toISOString()
      
      const doc = {
        id: docId,
        numero,
        type_document: type,
        statut: 'ACTIF',
        vente_id: vente.id,
        client_nom: forcePassenger ? 'Client Passager' : (vente.client_nom || 'Client Passager'),
        client_tel: forcePassenger ? null : (vente.client_tel || null),
        client_adresse: forcePassenger ? null : (vente.client_adresse || null),
        client_matricule: forcePassenger ? null : (vente.client_matricule || null),
        total_ht: sums.total_ht,
        total_tva: sums.total_tva,
        total_ttc: sums.total_ttc,
        statut_paiement: 'PAYE',
        montant_paye: netPay,
        timbre,
        total_remise: remisePanier,
        exo: null,
        tva_taux_principal: 19.0,
        ...tax,
        created_at: now,
        updated_at: now,
      }
      
      const result = await api.documentsCreate(doc, docLignes) as { success?: boolean; error?: string; id?: string; numero?: string } | undefined
      if (result?.success === false) throw new Error(result.error || 'Document non cree')
      setCreatedDoc({
        ...doc,
        id: result?.id || docId,
        numero: result?.numero || numero,
      } as DocType)
    }, { setLoading, successMessage: 'Document créé' })
  }

  if (createdDoc) {
    return <DocumentPrintModal doc={createdDoc} onClose={() => { onCreated(); onClose() }} />
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-sm">{forcePassenger ? 'Facture passager' : 'Convertir vente'} {vente.numero}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-2 mb-4">
          {!forcePassenger && ([
            ['FACTURE_VENTE', 'Facture', FileText],
            ['BON_LIVRAISON', 'Bon de livraison', FileCheck],
            ['DEVIS', 'Devis', FileText],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setType(id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold ${type === id ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
          {forcePassenger && (
            <div className="rounded-xl border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm font-semibold flex items-center gap-2">
              <FileText size={14} /> Facture vente - Client Passager
            </div>
          )}
        </div>
        {!canCreate ? (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4">
            {type === 'FACTURE_VENTE'
              ? 'Cette vente ne contient aucun produit facturé (F). Les produits NF ne peuvent pas être convertis en facture.'
              : 'Cette vente ne contient aucune ligne.'}
          </p>
        ) : nfOnDoc && nfLignes.length > 0 && type !== 'FACTURE_VENTE' ? (
          <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-4">
            BL / Devis : {eligibleLignes.length} ligne{eligibleLignes.length > 1 ? 's' : ''} incluant {nfLignes.length} NF.
          </p>
        ) : nfLignes.length > 0 ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
            {nfLignes.length} ligne{nfLignes.length > 1 ? 's' : ''} NF exclue{nfLignes.length > 1 ? 's' : ''} — seuls les produits F seront sur la facture ({fLignes.length} ligne{fLignes.length > 1 ? 's' : ''}).
          </p>
        ) : (
          <p className="text-xs text-text-secondary mb-4">
            {eligibleLignes.length} ligne{eligibleLignes.length > 1 ? 's' : ''} seront incluses.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 bg-muted rounded-xl text-sm font-semibold">Annuler</button>
          <button onClick={() => void handleCreate()} disabled={loading || !canCreate} className="flex-1 py-2.5 bg-accent-500 rounded-xl text-sm font-bold disabled:opacity-50">
            {loading ? 'Création…' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  )
}

export async function printVenteTicketQuick(vente: Vente): Promise<void> {
  const lignes = await api.ventesGetLignes(vente.id) as LigneVente[]
  await printFullHtmlDocument(buildReceiptTicketHtml(vente, lignes || []), {
    pageSize: '58mm',
    settingsKey: 'impression_printer_ticket',
    printKind: 'ticket',
  })
}
