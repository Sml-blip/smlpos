import { useState, useEffect } from 'react'
import type { Vente, LigneVente } from '../../lib/types'
import { formatPrice, generateId } from '../../lib/utils'
import { runAction, loadData } from '../../lib/apiCall'
import { printFullHtmlDocument } from '../../lib/nativePrint'
import { usePrintThermal } from '../../lib/usePrint'
import { X, Printer, FileText, FileCheck } from 'lucide-react'
import DocumentPrintModal from './DocumentPrintModal'
import type { Document as DocType } from '../../lib/types'
import {
  canCreateDocumentFromLignes,
  documentAllowsNF,
  filterLignesForDocument,
} from '../../lib/documentProductRules'

const api = window.api

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces', CARTE: 'Carte', CHEQUE: 'Chèque', MIXTE: 'Mixte',
}

function buildTicketHtml(vente: Vente, lignes: LigneVente[]): string {
  const date = new Date(vente.created_at)
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const itemsHtml = lignes.map(l => `
    <div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between"><span>${l.designation}</span><span>${l.total_ligne.toFixed(3)}</span></div>
      <div style="color:#666;padding-left:8px">${l.quantite} × ${l.prix_unitaire.toFixed(3)}</div>
    </div>`).join('')
  return `<!DOCTYPE html><html><head><style>@page{size:58mm auto;margin:2mm}body{font-family:monospace;font-size:11px;margin:0;padding:8px}</style></head><body>
    <div style="text-align:center;font-weight:bold">SMLPOS</div>
    <div style="text-align:center;font-size:10px">${dateStr} ${timeStr}</div>
    <div style="text-align:center;font-size:10px">Ticket ${vente.numero}</div>
    <hr style="border:none;border-top:1px dashed #999;margin:8px 0"/>
    ${itemsHtml}
    <hr style="border:none;border-top:1px dashed #999;margin:8px 0"/>
    <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>${vente.total_ttc.toFixed(3)} DT</span></div>
    <div style="font-size:10px;margin-top:4px">${MODE_LABELS[vente.mode_paiement] || vente.mode_paiement}</div>
  </body></html>`
}

export function VenteTicketPrintModal({ vente, onClose }: { vente: Vente; onClose: () => void }) {
  const [lignes, setLignes] = useState<LigneVente[]>([])
  const { printRef, handlePrint } = usePrintThermal(`Ticket-${vente.numero}`)

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
        <div ref={printRef} className="bg-white font-mono text-xs p-3 border border-border rounded-lg max-h-64 overflow-auto">
          {lignes.map(l => (
            <div key={l.id} className="mb-2">
              <div className="flex justify-between"><span>{l.designation}</span><span>{formatPrice(l.total_ligne)}</span></div>
            </div>
          ))}
          <div className="font-bold border-t pt-2 mt-2">Total: {formatPrice(vente.total_ttc)}</div>
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
  vente, onClose, onCreated,
}: { vente: Vente; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'FACTURE_VENTE' | 'BON_LIVRAISON' | 'DEVIS'>('FACTURE_VENTE')
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
      const totalHT = filtered.reduce((s, l) => s + l.total_ligne, 0)
      const year = new Date().getFullYear()
      const yy = String(year).slice(-2)
      const seqKey = type === 'DEVIS' ? `devis_sequence_${year}` : type === 'BON_LIVRAISON' ? `bl_vente_sequence_${year}` : `facture_vente_sequence_${year}`
      const prev = parseInt((await api.settingsGet(seqKey) as string) ?? '0') || 0
      const next = prev + 1
      await api.settingsSet(seqKey, String(next))
      const prefix = type === 'BON_LIVRAISON' ? 'BL' : type === 'DEVIS' ? 'DEV' : ''
      const numero = `${prefix}${yy}/#${String(next).padStart(5, '0')}`
      const docId = generateId()
      const now = new Date().toISOString()
      const doc = {
        id: docId,
        numero,
        type_document: type,
        statut: 'ACTIF',
        vente_id: vente.id,
        client_nom: vente.client_nom || 'Client Passager',
        client_tel: vente.client_tel || null,
        client_adresse: vente.client_adresse || null,
        client_matricule: vente.client_matricule || null,
        total_ht: totalHT,
        total_tva: 0,
        total_ttc: totalHT,
        statut_paiement: 'PAYE',
        montant_paye: totalHT,
        created_at: now,
        updated_at: now,
      }
      const docLignes = filtered.map(l => ({
        id: generateId(),
        document_id: docId,
        produit_id: l.produit_id || null,
        designation: l.designation,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        remise_pct: l.remise_pct || 0,
        tva_taux: l.type_produit === 'F' ? (l as LigneVente & { tva_taux?: number }).tva_taux ?? 0 : 0,
        total_ht: l.total_ligne,
        total_tva: 0,
        total_ttc: l.total_ligne,
        type_produit: l.type_produit,
      }))
      await api.documentsCreate(doc, docLignes)
      setCreatedDoc(doc as DocType)
    }, { setLoading, successMessage: 'Document créé' })
  }

  if (createdDoc) {
    return <DocumentPrintModal doc={createdDoc} onClose={() => { onCreated(); onClose() }} />
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-sm">Convertir vente {vente.numero}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-2 mb-4">
          {([
            ['FACTURE_VENTE', 'Facture', FileText],
            ['BON_LIVRAISON', 'Bon de livraison', FileCheck],
            ['DEVIS', 'Devis', FileText],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setType(id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold ${type === id ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
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
  await printFullHtmlDocument(buildTicketHtml(vente, lignes || []), {
    pageSize: '58mm',
    settingsKey: 'impression_printer_ticket',
    printKind: 'ticket',
  })
}
