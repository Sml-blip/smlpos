import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import type { CartItem, Vente } from '../../lib/types'
import { generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { X, Printer, CheckCircle, FileText, Edit2 } from 'lucide-react'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'
import type { InvoiceCompanySettings, InvoiceDocData, InvoiceLineData } from '../../components/InvoicePrintTemplate'
import {
  applyTotalsToDoc,
  buildInvoiceLineFromCart,
  sumInvoiceLines,
} from '../../lib/invoiceLineCalc'
import ClientPicker, { emptyClientForm, type ClientFormValue } from '../../components/ClientPicker'
import PinUnlockModal from '../../components/PinUnlockModal'
import InvoiceEditModal from '../../components/InvoiceEditModal'

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
  initialClientId?: string
  onClose: () => void
  onSuccess: () => void
}

export default function DocumentPreviewModal({
  items, vente, typeVente,
  initialClientNom = '', initialClientTel = '',
  initialClientAdresse = '', initialClientMatricule = '',
  initialClientId,
  onClose, onSuccess,
}: Props) {
  const { currentShift } = useAppStore()
  const [clientForm, setClientForm] = useState<ClientFormValue>({
    clientId: initialClientId,
    nom: initialClientNom,
    tel: initialClientTel,
    adresse: initialClientAdresse,
    matricule: initialClientMatricule,
  })
  const [settings, setSettings] = useState<InvoiceCompanySettings>({})
  const [loading, setLoading] = useState(false)
  const [docCreated, setDocCreated] = useState(false)
  const [docId, setDocId] = useState('')
  const [docNumero, setDocNumero] = useState('')
  const [showPinForEdit, setShowPinForEdit] = useState(false)
  const [showInvoiceEdit, setShowInvoiceEdit] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const typeDoc = typeVente === 'FACTURE' ? 'FACTURE_VENTE' : 'BON_LIVRAISON'
  const lignesItems = useMemo(
    () => (typeVente === 'FACTURE' ? items.filter(i => i.type_produit === 'F') : items),
    [items, typeVente],
  )

  const defaultTva = useMemo(
    () => parseFloat(String(settings.tva_defaut_pct ?? '19').replace(',', '.')) || 19,
    [settings.tva_defaut_pct],
  )

  const buildLineFromCart = useCallback((item: CartItem, idx: number): InvoiceLineData => {
    const tvaRate = item.type_produit === 'F' ? (item.tva_taux ?? defaultTva) : 0
    return buildInvoiceLineFromCart({
      id: item.produit_id || `line-${idx}`,
      designation: item.designation,
      quantite: item.quantite,
      prix_unitaire_ttc: item.prix_unitaire,
      remise_pct: item.remise_pct || 0,
      tva_taux: tvaRate,
      numero_serie: item.numero_serie ?? null,
    })
  }, [defaultTva])

  const docLignes: InvoiceLineData[] = useMemo(() => {
    return lignesItems.map((item, idx) => buildLineFromCart(item, idx))
  }, [lignesItems, buildLineFromCart])

  const lineSums = useMemo(() => sumInvoiceLines(docLignes), [docLignes])

  const previewDoc: InvoiceDocData = useMemo(() => applyTotalsToDoc({
    numero: docNumero || '—',
    type_document: typeDoc,
    client_nom: clientForm.nom || 'Client Passager',
    client_tel: clientForm.tel || null,
    client_adresse: clientForm.adresse || null,
    client_matricule: clientForm.matricule || null,
    total_ht: lineSums.total_ht,
    total_tva: lineSums.total_tva,
    total_ttc: lineSums.total_ttc,
    statut_paiement: 'PAYE',
    created_at: vente.created_at || new Date().toISOString(),
    timbre: settings.invoice_timbre_fiscal !== 'false' ? 1 : 0,
  }, docLignes), [docNumero, typeDoc, clientForm, lineSums, vente.created_at, settings.invoice_timbre_fiscal, docLignes])

  const totalTTC = lineSums.total_ttc

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

    const docPayload = {
      id: docId,
      numero,
      type_document: typeDoc,
      statut: 'ACTIF',
      shift_id: currentShift?.id ?? null,
      vente_id: vente.id,
      client_id: clientForm.clientId ?? null,
      client_nom: clientForm.nom.trim() || 'Client Passager',
      client_tel: clientForm.tel.trim() || null,
      client_adresse: clientForm.adresse.trim() || null,
      client_matricule: clientForm.matricule.trim() || null,
      total_ht: lineSums.total_ht,
      total_tva: lineSums.total_tva,
      total_ttc: lineSums.total_ttc,
      statut_paiement: 'PAYE',
      montant_paye: lineSums.total_ttc,
      timbre: previewDoc.timbre ?? 1,
      created_at: now,
      updated_at: now,
    }

    const builtLines = lignesItems.map((item, idx) => buildLineFromCart(item, idx))
    const lignes = lignesItems.map((item, idx) => {
      const line = builtLines[idx]
      return {
        id: generateId(),
        document_id: docId,
        produit_id: item.produit_id ?? null,
        designation: line.designation,
        quantite: line.quantite,
        prix_unitaire: line.prix_unitaire,
        remise_pct: line.remise_pct,
        tva_taux: line.tva_taux,
        total_ht: line.total_ht,
        total_tva: line.total_tva,
        total_ttc: line.total_ttc,
        type_produit: item.type_produit,
        numero_serie: line.numero_serie ?? null,
      }
    })

    await api.documentsCreate(docPayload, lignes)
    setDocId(docId)
    return numero
  }

  const reloadDocLines = async () => {
    if (!docId) return
    await api.documentsGetLignes(docId)
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

  if (showInvoiceEdit && docId) {
    return (
      <InvoiceEditModal
        mode="vente"
        documentId={docId}
        onClose={() => { setShowInvoiceEdit(false); setDocCreated(true) }}
        onSaved={() => { void reloadDocLines(); setShowInvoiceEdit(false); setDocCreated(true) }}
      />
    )
  }

  if (showPinForEdit) {
    return (
      <PinUnlockModal
        title={`Modifier ${docNumero}`}
        onCancel={() => { setShowPinForEdit(false); setDocCreated(true) }}
        onUnlocked={() => { setShowPinForEdit(false); setShowInvoiceEdit(true) }}
      />
    )
  }

  if (docCreated && !showInvoiceEdit) {
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
            <button type="button" onClick={() => { setShowPinForEdit(true); setDocCreated(false) }}
              className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">
              <Edit2 size={14} /> Modifier
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
            <ClientPicker value={clientForm} onChange={setClientForm} required />

            {/* Lines summary */}
            <div className="bg-muted rounded-lg p-3 text-xs text-text-secondary">
              <div className="font-semibold mb-1">
                {lignesItems.length} ligne{lignesItems.length !== 1 ? 's' : ''}
                {typeVente === 'FACTURE' && ' (F uniquement)'}
              </div>
              <div>HT : {lineSums.total_ht.toFixed(3)} DT</div>
              {settings.invoice_show_tva !== 'false' && (
                <div>TVA : {lineSums.total_tva.toFixed(3)} DT</div>
              )}
              <div className="font-price font-bold text-text-primary">TTC : {totalTTC.toFixed(3)} DT</div>
            </div>

            {lignesItems.length === 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                Aucune ligne éligible pour ce type de document.
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="flex-1 overflow-auto max-h-[70vh] bg-gray-50 p-2 sm:p-4" ref={previewRef}>
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
