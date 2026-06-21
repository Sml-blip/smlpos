import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import type { CartItem, Vente } from '../../lib/types'
import { generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { X, Printer, CheckCircle, FileText, Edit2, Plus, Trash2 } from 'lucide-react'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'
import type { InvoiceCompanySettings, InvoiceDocData, InvoiceLineData } from '../../components/InvoicePrintTemplate'

const api = window.api

type TypeVente = 'FACTURE' | 'BL_VENTE'

interface Props {
  items: CartItem[]
  vente: Vente
  typeVente: TypeVente
  initialClientNom?: string
  initialClientTel?: string
  initialClientAdresse?: string
  initialClientMatricule?: string
  onClose: () => void
  onSuccess: () => void
}

export default function DocumentPreviewModal({
  items, vente, typeVente,
  initialClientNom = '', initialClientTel = '',
  initialClientAdresse = '', initialClientMatricule = '',
  onClose, onSuccess,
}: Props) {
  const { currentShift } = useAppStore()
  const [clientNom, setClientNom] = useState(initialClientNom)
  const [clientTel, setClientTel] = useState(initialClientTel)
  const [clientAdresse, setClientAdresse] = useState(initialClientAdresse)
  const [clientMatricule, setClientMatricule] = useState(initialClientMatricule)
  const [settings, setSettings] = useState<InvoiceCompanySettings>({})
  const [loading, setLoading] = useState(false)
  const [docCreated, setDocCreated] = useState(false)
  const [docId, setDocId] = useState('')
  const [docNumero, setDocNumero] = useState('')
  const [editLinesMode, setEditLinesMode] = useState(false)
  const [editableLignes, setEditableLignes] = useState<InvoiceLineData[]>([])
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const typeDoc = typeVente === 'FACTURE' ? 'FACTURE_VENTE' : 'BON_LIVRAISON'
  // FACTURE: F items only. BL_VENTE: all items
  const lignesItems = typeVente === 'FACTURE' ? items.filter(i => i.type_produit === 'F') : items

  const docLignes: InvoiceLineData[] = (docId || editLinesMode)
    ? editableLignes
    : lignesItems.map((item, idx) => ({
    id: item.produit_id || `line-${idx}`,
    designation: item.designation,
    quantite: item.quantite,
    prix_unitaire: item.prix_unitaire,
    remise_pct: item.remise_pct || 0,
    tva_taux: 0,
    total_ht: item.total_ligne,
    total_tva: 0,
    total_ttc: item.total_ligne,
  }))

  const totalHT = docLignes.reduce((s, l) => s + l.total_ht, 0)
  const totalTTC = totalHT

  const previewDoc: InvoiceDocData = {
    numero: docNumero || '—',
    type_document: typeDoc,
    client_nom: clientNom || 'Client Passager',
    client_tel: clientTel || null,
    client_adresse: clientAdresse || null,
    client_matricule: clientMatricule || null,
    total_ht: totalHT,
    total_tva: 0,
    total_ttc: totalTTC,
    statut_paiement: 'PAYE',
    created_at: vente.created_at || new Date().toISOString(),
  }

  useEffect(() => {
    loadData('Chargement paramètres', () => api.settingsGetAll(), { silent: true }).then((s: unknown) => {
      if (s) setSettings((s as InvoiceCompanySettings) || {})
    })
  }, [])

  const getNextNumero = async (): Promise<string> => {
    const year = new Date().getFullYear()
    const yy = String(year).slice(-2)
    const seqKey = typeVente === 'FACTURE'
      ? `facture_vente_sequence_${year}`
      : `bl_vente_sequence_${year}`
    const prevSeqRaw = await api.settingsGet(seqKey) as string | null
    const prevSeq = parseInt(prevSeqRaw ?? '0') || 0
    const nextSeq = prevSeq + 1
    await api.settingsSet(seqKey, String(nextSeq))
    const prefix = typeVente === 'BL_VENTE' ? 'BL' : ''
    return `${prefix}${yy}/#${String(nextSeq).padStart(5, '0')}`
  }

  const createDocument = async (): Promise<string> => {
    const numero = await getNextNumero()
    const now = new Date().toISOString()
    const docId = generateId()

    const doc = {
      id: docId,
      numero,
      type_document: typeDoc,
      statut: 'ACTIF',
      shift_id: currentShift?.id ?? null,
      vente_id: vente.id,
      client_nom: clientNom.trim() || 'Client Passager',
      client_tel: clientTel.trim() || null,
      client_adresse: clientAdresse.trim() || null,
      client_matricule: clientMatricule.trim() || null,
      total_ht: totalHT,
      total_tva: 0,
      total_ttc: totalTTC,
      statut_paiement: 'PAYE',
      montant_paye: totalTTC,
      created_at: now,
      updated_at: now,
    }

    const lignes = lignesItems.map(item => ({
      id: generateId(),
      document_id: docId,
      produit_id: item.produit_id || null,
      designation: item.designation,
      quantite: item.quantite,
      prix_unitaire: item.prix_unitaire,
      remise_pct: item.remise_pct || 0,
      tva_taux: 0,
      total_ht: item.total_ligne,
      total_tva: 0,
      total_ttc: item.total_ligne,
      type_produit: item.type_produit,
    }))

    await api.documentsCreate(doc, lignes)
    setDocId(docId)
    setEditableLignes(lignesItems.map((item, idx) => ({
      id: item.produit_id || `line-${idx}`,
      designation: item.designation,
      quantite: item.quantite,
      prix_unitaire: item.prix_unitaire,
      remise_pct: item.remise_pct || 0,
      tva_taux: 0,
      total_ht: item.total_ligne,
      total_tva: 0,
      total_ttc: item.total_ligne,
    })))
    return numero
  }

  const saveLineEdits = async () => {
    if (!docId) return
    await runAction('Mise à jour lignes', async () => {
      const lignes = editableLignes.map(l => ({
        id: l.id.startsWith('line-') ? generateId() : l.id,
        document_id: docId,
        produit_id: null,
        designation: l.designation,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        remise_pct: l.remise_pct,
        tva_taux: l.tva_taux,
        total_ht: l.total_ht,
        total_tva: l.total_tva,
        total_ttc: l.total_ttc,
        type_produit: 'F',
      }))
      await api.documentsReplaceLignes?.(docId, lignes, { total_ht: totalHT, total_tva: 0, total_ttc: totalTTC })
      setEditLinesMode(false)
      setDocCreated(true)
    }, { successMessage: 'Lignes mises à jour' })
  }

  const updateLine = (idx: number, patch: Partial<InvoiceLineData>) => {
    setEditableLignes(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const next = { ...l, ...patch }
      const brut = next.quantite * next.prix_unitaire * (1 - (next.remise_pct || 0) / 100)
      next.total_ht = brut
      next.total_tva = 0
      next.total_ttc = brut
      return next
    }))
  }

  const handleConfirm = async () => {
    await runAction('Création document', async () => {
      const numero = await createDocument()
      setDocNumero(numero)
      setDocCreated(true)
    }, { setLoading, successMessage: 'Document créé' })
  }

  const handlePrintClick = async () => {
    await runAction('Préparation impression', async () => {
      if (!docId) {
        const numero = await createDocument()
        setDocNumero(numero)
      }
      await new Promise<void>(resolve => setTimeout(resolve, 80))
      setShowPrintDialog(true)
    }, { setLoading })
  }

  if (showPrintDialog) {
    return (
      <PrintDialog
        title={typeDoc === 'FACTURE_VENTE' ? 'Imprimer facture' : 'Imprimer bon de livraison'}
        subtitle={docNumero || previewDoc.numero}
        getPrintHtml={() => previewRef.current?.innerHTML ?? ''}
        preview={
          <InvoicePrintTemplate
            doc={{ ...previewDoc, numero: docNumero || previewDoc.numero }}
            lignes={docLignes}
            settings={settings}
          />
        }
        pageSize="A4"
        settingsKey="impression_printer_a4"
        onClose={() => { setShowPrintDialog(false); setDocCreated(true) }}
        onPrinted={() => setDocCreated(true)}
      />
    )
  }

  if (docCreated && !editLinesMode) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-8 text-center animate-slide-in">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-success" />
          </div>
          <h2 className="font-bold text-xl mb-1">Document créé</h2>
          <p className="text-sm text-text-secondary mb-1">N° :</p>
          <p className="font-bold text-lg text-text-primary mb-6">{docNumero}</p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { setEditLinesMode(true); setDocCreated(false) }}
              className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">
              <Edit2 size={14} /> Modifier les produits
            </button>
            <button type="button" onClick={() => setShowPrintDialog(true)}
              className="w-full flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 font-bold py-2.5 rounded-xl text-sm">
              <Printer size={14} /> Imprimer
            </button>
            <button type="button" onClick={onSuccess}
              className="w-full text-text-secondary hover:text-text-primary py-2 text-sm">
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (editLinesMode) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-bold text-sm">Modifier produits — {docNumero}</h2>
            <button type="button" onClick={() => { setEditLinesMode(false); setDocCreated(true) }}><X size={18} /></button>
          </div>
          <div className="p-5 space-y-2">
            {editableLignes.map((l, i) => (
              <div key={l.id} className="flex gap-2 items-center">
                <input value={l.designation} onChange={e => updateLine(i, { designation: e.target.value })}
                  className="flex-1 border border-border rounded-lg px-2 py-1.5 text-sm" />
                <input type="text" inputMode="numeric" value={l.quantite} onChange={e => updateLine(i, { quantite: parseInt(e.target.value) || 1 })}
                  className="w-14 border border-border rounded-lg px-2 py-1.5 text-sm text-center" />
                <input type="text" inputMode="decimal" value={l.prix_unitaire} onChange={e => updateLine(i, { prix_unitaire: parseFloat(e.target.value.replace(',', '.')) || 0 })}
                  className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm font-price" />
                <button type="button" onClick={() => setEditableLignes(prev => prev.filter((_, j) => j !== i))} className="text-danger"><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setEditableLignes(prev => [...prev, {
              id: generateId(), designation: '', quantite: 1, prix_unitaire: 0, remise_pct: 0, tva_taux: 0, total_ht: 0, total_tva: 0, total_ttc: 0,
            }])} className="text-xs font-semibold text-accent-600 flex items-center gap-1"><Plus size={12} /> Ajouter ligne</button>
            <div className="text-right font-price font-bold pt-2">Total : {totalTTC.toFixed(3)} DT</div>
          </div>
          <div className="flex gap-2 px-5 py-4 border-t border-border">
            <button type="button" onClick={() => { setEditLinesMode(false); setDocCreated(true) }} className="flex-1 py-2.5 bg-muted rounded-xl text-sm font-semibold">Annuler</button>
            <button type="button" onClick={() => void saveLineEdits()} className="flex-1 py-2.5 bg-accent-500 rounded-xl text-sm font-bold">Enregistrer</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-auto p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-4 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-accent-500" />
            <h2 className="font-bold text-base">
              {typeDoc === 'FACTURE_VENTE' ? 'Facture Client' : 'Bon de Livraison'}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex divide-x divide-border">
          {/* Left: editable client fields */}
          <div className="w-72 flex-shrink-0 p-5 space-y-4">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Informations client</h3>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom / Raison sociale</label>
              <input
                type="text"
                value={clientNom}
                onChange={e => setClientNom(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
                placeholder="Client Passager"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Téléphone</label>
              <input
                type="text"
                value={clientTel}
                onChange={e => setClientTel(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
                placeholder="2x xxx xxx"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Matricule fiscal</label>
              <input
                type="text"
                value={clientMatricule}
                onChange={e => setClientMatricule(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500"
                placeholder="MF-..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Adresse</label>
              <textarea
                value={clientAdresse}
                onChange={e => setClientAdresse(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500 resize-none h-16"
                placeholder="Adresse (optionnel)"
              />
            </div>

            {/* Lines summary */}
            <div className="bg-muted rounded-lg p-3 text-xs text-text-secondary">
              <div className="font-semibold mb-1">
                {lignesItems.length} ligne{lignesItems.length !== 1 ? 's' : ''}
                {typeVente === 'FACTURE' && ' (F uniquement)'}
              </div>
              <div className="font-price font-bold text-text-primary">Total : {totalTTC.toFixed(3)} DT</div>
            </div>

            {lignesItems.length === 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                Aucune ligne éligible pour ce type de document.
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="flex-1 overflow-auto max-h-[65vh] bg-gray-50" ref={previewRef}>
            <InvoicePrintTemplate
              doc={previewDoc}
              lignes={docLignes}
              settings={settings}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="bg-muted hover:bg-border text-text-primary font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
          >
            Annuler
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || lignesItems.length === 0}
            className="flex items-center gap-2 bg-muted hover:bg-border text-text-primary font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <CheckCircle size={14} />
            {loading ? 'En cours...' : 'Confirmer sans imprimer'}
          </button>
          <button
            type="button"
            onClick={handlePrintClick}
            disabled={loading || lignesItems.length === 0}
            className="flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold px-5 py-2.5 rounded-xl transition-colors text-sm disabled:opacity-50"
          >
            <Printer size={14} />
            {loading ? 'En cours...' : 'Imprimer'}
          </button>
        </div>
      </div>
    </div>
  )
}
