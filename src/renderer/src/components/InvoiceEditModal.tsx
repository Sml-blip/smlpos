import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, RefreshCw, Save, FileText, Package } from 'lucide-react'
import type { Document, Fournisseur, Produit } from '../lib/types'
import { cn, formatPrice, generateId } from '../lib/utils'
import { runAction } from '../lib/apiCall'
import { showToast } from '../lib/toast'
import ClientPicker, { type ClientFormValue } from './ClientPicker'
import InvoicePrintTemplate, { type InvoiceLineData, type InvoiceDocData } from './InvoicePrintTemplate'
import InventoryProductPickerModal, { type ProductPickerFilter } from './InventoryProductPickerModal'
import {
  normalizeInvoiceLine, recalcInvoiceLineFromHtUnit, sumInvoiceLines, applyTotalsToDoc,
  buildInvoiceLineFromCart,
} from '../lib/invoiceLineCalc'
import { mapFactureAchatLignes, buildAchatInvoiceDoc } from '../lib/invoiceAchatMapper'

const api = window.api

type VenteEditLine = InvoiceLineData & { produit_id?: string | null }

interface AchatLigne {
  id: string
  designation: string
  quantite: number
  nouveau_prix_achat: number
  tva_taux: number
  produit_id?: string
  numeros_serie_json?: string | null
}

interface Props {
  mode: 'vente' | 'achat'
  documentId: string
  onClose: () => void
  onSaved: () => void
}

function computeAchatTotals(lignes: AchatLigne[], exo: boolean, remise: number, timbre: number) {
  let montantHT = 0
  let montantTVA = 0
  let ht_7 = 0, tva_7 = 0, ht_19 = 0, tva_19 = 0
  for (const l of lignes) {
    const ht = l.quantite * l.nouveau_prix_achat
    const tva = exo ? 0 : ht * (l.tva_taux / 100)
    montantHT += ht
    montantTVA += tva
    if (l.tva_taux === 7) { ht_7 += ht; tva_7 += tva }
    else if (l.tva_taux === 19) { ht_19 += ht; tva_19 += tva }
  }
  const montantTTC = exo ? montantHT : montantHT + montantTVA
  return {
    montant_ht: Math.round(montantHT * 1000) / 1000,
    montant_tva: Math.round(montantTVA * 1000) / 1000,
    montant_ttc: Math.round(montantTTC * 1000) / 1000,
    ht_7: ht_7 || null, tva_7: tva_7 || null, ht_19: ht_19 || null, tva_19: tva_19 || null,
    total_remise: remise, timbre,
    net: Math.round((montantTTC - remise + timbre) * 1000) / 1000,
  }
}

export default function InvoiceEditModal({ mode, documentId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})

  const [numero, setNumero] = useState('')
  const [typeDoc, setTypeDoc] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [clientForm, setClientForm] = useState<ClientFormValue>({ nom: '', tel: '', adresse: '', matricule: '' })
  const [fournisseurId, setFournisseurId] = useState('')
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([])
  const [venteLines, setVenteLines] = useState<VenteEditLine[]>([])
  const [achatLines, setAchatLines] = useState<AchatLigne[]>([])
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [timbre, setTimbre] = useState(1)
  const [remise, setRemise] = useState(0)
  const [exo, setExo] = useState('')
  const [statutReception, setStatutReception] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.settingsGetAll() as Record<string, string>
        setSettings(s || {})
        if (mode === 'vente') {
          const doc = await api.documentsGet?.(documentId) as Document | null
          if (!doc) { setError('Document introuvable'); return }
          if (['ANNULE', 'REVOQUE'].includes(doc.statut) || doc.type_document === 'AVOIR') {
            setError('Document non modifiable'); return
          }
          setNumero(doc.numero)
          setTypeDoc(doc.type_document)
          setCreatedAt(doc.created_at)
          setClientForm({
            clientId: doc.client_id ?? undefined,
            nom: doc.client_nom ?? '',
            tel: doc.client_tel ?? '',
            adresse: doc.client_adresse ?? '',
            matricule: doc.client_matricule ?? '',
          })
          setTimbre(doc.timbre ?? 1)
          setRemise(doc.total_remise ?? 0)
          setExo(doc.exo ?? '')
          const lignes = await api.documentsGetLignes(documentId) as (InvoiceLineData & { produit_id?: string | null })[]
          setVenteLines(lignes.map(l => normalizeInvoiceLine({
            ...l,
            id: l.id || generateId(),
            produit_id: l.produit_id ?? null,
          })))
        } else {
          const [facture, lignes, fourns] = await Promise.all([
            api.facturesFournisseursGet?.(documentId) as Promise<Record<string, unknown>>,
            api.facturesFournisseursGetLignes?.(documentId) as Promise<Record<string, unknown>[]>,
            api.fournisseursList() as Promise<Fournisseur[]>,
          ])
          if (!facture) { setError('Facture introuvable'); return }
          if (facture.statut_paiement === 'BROUILLON' || facture.statut_paiement === 'ANNULE') {
            setError('Facture non modifiable'); return
          }
          setFournisseurs(fourns || [])
          setNumero(String(facture.numero_facture ?? ''))
          setTypeDoc(String(facture.type ?? 'FACTURE_ACHAT'))
          setCreatedAt(String(facture.date_facture ?? facture.created_at ?? ''))
          setFournisseurId(String(facture.fournisseur_id ?? ''))
          setTimbre(Number(facture.timbre ?? 1))
          setRemise(Number(facture.total_remise ?? 0))
          setExo(String(facture.exo ?? ''))
          setStatutReception(String(facture.statut_reception ?? 'ARRIVE'))
          setAchatLines((lignes || []).map(l => ({
            id: String(l.id),
            designation: String(l.designation ?? ''),
            quantite: Number(l.quantite) || 1,
            nouveau_prix_achat: Number(l.nouveau_prix_achat) || 0,
            tva_taux: Number(l.tva_taux) || 0,
            produit_id: l.produit_id ? String(l.produit_id) : undefined,
            numeros_serie_json: l.numeros_serie_json ?? null,
          })))
        }
      } catch {
        setError('Erreur de chargement')
      } finally {
        setLoading(false)
      }
    })()
  }, [mode, documentId])

  const selectedFournisseur = fournisseurs.find(f => f.id === fournisseurId)

  const previewDoc = useMemo((): InvoiceDocData | null => {
    if (loading || error) return null
    if (mode === 'vente') {
      const sums = sumInvoiceLines(venteLines)
      return applyTotalsToDoc({
        numero,
        type_document: typeDoc,
        client_nom: clientForm.nom,
        client_tel: clientForm.tel,
        client_adresse: clientForm.adresse,
        client_matricule: clientForm.matricule,
        total_ht: sums.total_ht,
        total_tva: sums.total_tva,
        total_ttc: sums.total_ttc,
        statut_paiement: 'PAYE',
        created_at: createdAt,
        timbre,
        total_remise: remise,
        exo: exo || null,
      }, venteLines, { timbre, total_remise: remise })
    }
    const totals = computeAchatTotals(achatLines, !!exo, remise, timbre)
    const fn = selectedFournisseur?.nom ?? 'Fournisseur'
    return buildAchatInvoiceDoc({
      numero,
      type: typeDoc as 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL',
      fournisseurNom: fn,
      fournisseurTel: selectedFournisseur?.telephone,
      fournisseurAdresse: selectedFournisseur?.adresse,
      fournisseurMatricule: selectedFournisseur?.matricule_fiscal,
      dateFacture: createdAt,
      montantHT: totals.montant_ht,
      montantTVA: totals.montant_tva,
      montantTTC: totals.montant_ttc,
      exoFlag: !!exo,
      exoText: exo,
      remiseGlobale: remise,
      timbre,
    })
  }, [mode, loading, error, venteLines, achatLines, clientForm, selectedFournisseur, numero, typeDoc, createdAt, timbre, remise, exo])

  const previewLignes = useMemo(() => {
    if (mode === 'vente') return venteLines
    return mapFactureAchatLignes(achatLines, [], !!exo)
  }, [mode, venteLines, achatLines, exo])

  const defaultTva = useMemo(
    () => parseFloat(String(settings.tva_defaut_pct ?? '19').replace(',', '.')) || 19,
    [settings.tva_defaut_pct],
  )

  const productPickerFilter = useMemo((): ProductPickerFilter => {
    if (mode === 'achat') return 'all'
    if (typeDoc === 'FACTURE_VENTE' || typeDoc === 'FACTURE_JOURNALIERE_F') return 'F'
    return 'all'
  }, [mode, typeDoc])

  const addVenteProductFromInventory = (p: Produit) => {
    const tvaRate = p.type === 'F' ? (p.tva_taux ?? defaultTva) : 0
    setVenteLines(prev => {
      const idx = prev.findIndex(l => l.produit_id === p.id)
      if (idx >= 0) {
        return prev.map((l, i) => {
          if (i !== idx) return l
          return recalcInvoiceLineFromHtUnit({ ...l, quantite: l.quantite + 1 })
        })
      }
      const line = buildInvoiceLineFromCart({
        id: generateId(),
        designation: p.nom,
        quantite: 1,
        prix_unitaire_ttc: p.prix_vente,
        remise_pct: 0,
        tva_taux: tvaRate,
        reference: p.reference,
        numero_serie: p.numero_serie ?? null,
      })
      return [...prev, { ...line, produit_id: p.id }]
    })
  }

  const addAchatProductFromInventory = (p: Produit) => {
    setAchatLines(prev => {
      const idx = prev.findIndex(l => l.produit_id === p.id)
      if (idx >= 0) {
        return prev.map((l, i) => i === idx ? { ...l, quantite: l.quantite + 1 } : l)
      }
      return [...prev, {
        id: generateId(),
        designation: p.nom,
        quantite: 1,
        nouveau_prix_achat: p.prix_achat ?? p.prix_vente ?? 0,
        tva_taux: exo ? 0 : (p.tva_taux ?? defaultTva),
        produit_id: p.id,
      }]
    })
  }

  const addEmptyLine = () => {
    if (mode === 'vente') {
      setVenteLines(prev => [...prev, {
        id: generateId(), designation: '', quantite: 1, prix_unitaire: 0, remise_pct: 0, tva_taux: defaultTva,
        total_ht: 0, total_tva: 0, total_ttc: 0, produit_id: null,
      }])
    } else {
      setAchatLines(prev => [...prev, {
        id: generateId(), designation: '', quantite: 1, nouveau_prix_achat: 0, tva_taux: defaultTva,
      }])
    }
  }

  const updateVenteLine = (idx: number, patch: Partial<VenteEditLine>) => {
    setVenteLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const next = { ...l, ...patch }
      if (patch.designation !== undefined && patch.designation !== l.designation) {
        next.produit_id = null
      }
      return recalcInvoiceLineFromHtUnit(next)
    }))
  }

  const updateAchatLine = (idx: number, patch: Partial<AchatLigne>) => {
    setAchatLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  const handleSave = async () => {
    const lines = mode === 'vente' ? venteLines : achatLines
    if (!lines.length || lines.every(l => !String(l.designation ?? '').trim())) {
      showToast('error', 'Ajoutez au moins une ligne avec une désignation')
      return
    }
    await runAction('Enregistrement facture', async () => {
      if (mode === 'vente') {
        const sums = sumInvoiceLines(venteLines)
        let ht_7 = 0, tva_7 = 0, ht_19 = 0, tva_19 = 0
        venteLines.forEach(l => {
          if (l.tva_taux === 7) { ht_7 += l.total_ht; tva_7 += l.total_tva }
          else if (l.tva_taux === 19) { ht_19 += l.total_ht; tva_19 += l.total_tva }
        })
        await api.documentsUpdate(documentId, {
          client_id: clientForm.clientId ?? null,
          client_nom: clientForm.nom,
          client_tel: clientForm.tel,
          client_adresse: clientForm.adresse,
          client_matricule: clientForm.matricule,
          total_ht: sums.total_ht,
          total_tva: sums.total_tva,
          total_ttc: sums.total_ttc,
          timbre,
          total_remise: remise,
          exo: exo || null,
          ht_7: ht_7 || null, tva_7: tva_7 || null, ht_19: ht_19 || null, tva_19: tva_19 || null,
        })
        const res = await api.documentsReplaceLignes?.(documentId, venteLines.map(l => ({
          id: l.id,
          produit_id: l.produit_id ?? null,
          designation: l.designation.trim() || 'Article',
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire,
          remise_pct: l.remise_pct,
          tva_taux: l.tva_taux,
          total_ht: l.total_ht,
          total_tva: l.total_tva,
          total_ttc: l.total_ttc,
          type_produit: 'F',
          numero_serie: l.numero_serie ?? null,
        })), {
          total_ht: sums.total_ht, total_tva: sums.total_tva, total_ttc: sums.total_ttc,
          ht_7: ht_7 || null, tva_7: tva_7 || null, ht_19: ht_19 || null, tva_19: tva_19 || null,
        })
        if (res && !res.success) throw new Error(res.error || 'Échec enregistrement lignes')
      } else {
        const totals = computeAchatTotals(achatLines, !!exo, remise, timbre)
        await api.facturesFournisseursUpdate?.(documentId, {
          fournisseur_id: fournisseurId,
          exo: exo || null,
          timbre,
          total_remise: remise,
          montant_ht: totals.montant_ht,
          montant_tva: totals.montant_tva,
          montant_ttc: totals.montant_ttc,
          ht_7: totals.ht_7, tva_7: totals.tva_7, ht_19: totals.ht_19, tva_19: totals.tva_19,
        })
        const res = await api.facturesFournisseursReplaceLignes?.(documentId, achatLines.map(l => ({
          id: l.id,
          produit_id: l.produit_id ?? null,
          designation: l.designation,
          quantite: l.quantite,
          ancien_prix_achat: 0,
          nouveau_prix_achat: l.nouveau_prix_achat,
          tva_taux: exo ? 0 : l.tva_taux,
          numeros_serie_json: l.numeros_serie_json ?? null,
        })), totals)
        if (res && !res.success) throw new Error(res.error || 'Échec enregistrement lignes')
      }
      onSaved()
      onClose()
    }, { setSaving, successMessage: 'Facture modifiée', onError: setError })
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150]">
        <RefreshCw size={24} className="animate-spin text-white" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150] p-4">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
          <p className="text-danger font-semibold">{error}</p>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-muted rounded-xl text-sm font-semibold">Fermer</button>
        </div>
      </div>
    )
  }

  const venteSums = sumInvoiceLines(venteLines)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150] p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-bold text-sm flex items-center gap-2">
              <FileText size={15} className="text-accent-500" /> Modifier — {numero}
            </h2>
            <p className="text-[10px] text-text-muted mt-0.5">{typeDoc.replace(/_/g, ' ')} · N° immuable</p>
          </div>
          <button type="button" onClick={onClose}><X size={18} className="text-text-muted" /></button>
        </div>

        {mode === 'achat' && statutReception === 'NON_ARRIVE' && (
          <div className="mx-5 mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            Bon de livraison non reçu — seules les lignes sont modifiées (stock à la réception).
          </div>
        )}
        {mode === 'achat' && statutReception === 'ARRIVE' && (
          <div className="mx-5 mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            Les quantités modifiées mettent à jour le stock et les numéros de série liés.
          </div>
        )}
        {mode === 'vente' && (
          <div className="mx-5 mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            Les lignes liées à une vente POS synchronisent automatiquement le stock et les S/N.
          </div>
        )}

        <div className="flex flex-1 min-h-0 divide-x divide-border">
          <div className="w-96 flex-shrink-0 overflow-y-auto p-4 space-y-4">
            {mode === 'vente' ? (
              <ClientPicker value={clientForm} onChange={setClientForm} required />
            ) : (
              <div>
                <label className="block text-xs font-semibold mb-1.5">Fournisseur</label>
                <select value={fournisseurId} onChange={e => setFournisseurId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-500">
                  <option value="">— Sélectionner —</option>
                  {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                </select>
              </div>
            )}

            {mode === 'achat' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold mb-1">Exo</label>
                  <input value={exo} onChange={e => setExo(e.target.value)} className="w-full border border-border rounded-lg px-2 py-1.5 text-xs" placeholder="Exonéré..." />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold mb-1">Timbre</label>
                  <input type="number" step="0.001" value={timbre} onChange={e => setTimbre(parseFloat(e.target.value) || 0)}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-semibold mb-1">Remise globale</label>
                  <input type="number" step="0.001" value={remise} onChange={e => setRemise(parseFloat(e.target.value) || 0)}
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs font-price" />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Lignes</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowProductPicker(true)}
                    className="text-[10px] font-bold text-white bg-accent-500 hover:bg-accent-600 px-2 py-1 rounded-lg flex items-center gap-0.5"
                  >
                    <Package size={11} /> Inventaire
                  </button>
                  <button
                    type="button"
                    onClick={addEmptyLine}
                    className="text-[10px] font-bold text-accent-600 border border-accent-300 hover:bg-accent-50 px-2 py-1 rounded-lg flex items-center gap-0.5"
                  >
                    <Plus size={11} /> Ligne vide
                  </button>
                </div>
              </div>

              {mode === 'vente' ? venteLines.map((l, i) => (
                <div key={l.id} className="border border-border rounded-lg p-2 space-y-1">
                  {l.reference && (
                    <div className="text-[9px] font-mono text-text-muted">{l.reference}{l.produit_id ? ' · catalogue' : ''}</div>
                  )}
                  <input value={l.designation} onChange={e => updateVenteLine(i, { designation: e.target.value })}
                    className="w-full border border-border rounded px-2 py-1 text-xs" placeholder="Désignation" />
                  <div className="flex gap-1">
                    <input type="number" value={l.quantite} onChange={e => updateVenteLine(i, { quantite: parseInt(e.target.value) || 1 })}
                      className="w-12 border border-border rounded px-1 py-1 text-xs text-center" title="Qté" />
                    <input type="number" step="0.001" value={l.prix_unitaire} onChange={e => updateVenteLine(i, { prix_unitaire: parseFloat(e.target.value) || 0 })}
                      className="flex-1 border border-border rounded px-2 py-1 text-xs font-price" title="P.U. HT" />
                    <input type="number" value={l.tva_taux} onChange={e => updateVenteLine(i, { tva_taux: parseFloat(e.target.value) || 0 })}
                      className="w-12 border border-border rounded px-1 py-1 text-xs text-center" title="TVA %" />
                    <button type="button" onClick={() => setVenteLines(prev => prev.filter((_, j) => j !== i))} className="text-danger p-1"><Trash2 size={12} /></button>
                  </div>
                  <div className="text-[10px] text-right font-price text-text-muted">TTC {formatPrice(l.total_ttc)}</div>
                </div>
              )) : achatLines.map((l, i) => (
                <div key={l.id} className="border border-border rounded-lg p-2 space-y-1">
                  <input value={l.designation} onChange={e => updateAchatLine(i, { designation: e.target.value })}
                    className="w-full border border-border rounded px-2 py-1 text-xs" />
                  <div className="flex gap-1">
                    <input type="number" value={l.quantite} onChange={e => updateAchatLine(i, { quantite: parseInt(e.target.value) || 1 })}
                      className="w-12 border border-border rounded px-1 py-1 text-xs text-center" />
                    <input type="number" step="0.001" value={l.nouveau_prix_achat} onChange={e => updateAchatLine(i, { nouveau_prix_achat: parseFloat(e.target.value) || 0 })}
                      className="flex-1 border border-border rounded px-2 py-1 text-xs font-price" />
                    <input type="number" value={l.tva_taux} onChange={e => updateAchatLine(i, { tva_taux: parseFloat(e.target.value) || 0 })}
                      className="w-12 border border-border rounded px-1 py-1 text-xs text-center" disabled={!!exo} />
                    <button type="button" onClick={() => setAchatLines(prev => prev.filter((_, j) => j !== i))} className="text-danger p-1"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-xs font-price font-bold text-right border-t border-border pt-2">
              Total TTC : {formatPrice(mode === 'vente' ? venteSums.total_ttc : computeAchatTotals(achatLines, !!exo, remise, timbre).montant_ttc)}
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-gray-50 p-2 min-h-0">
            {previewDoc && (
              <InvoicePrintTemplate doc={previewDoc} lignes={previewLignes} settings={settings} />
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border flex-shrink-0">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl text-sm">Annuler</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}
            className={cn('flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2')}>
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>

      {showProductPicker && (
        <InventoryProductPickerModal
          title={mode === 'vente' ? 'Ajouter produit — facture vente' : 'Ajouter produit — facture achat'}
          productFilter={productPickerFilter}
          onAddProduct={mode === 'vente' ? addVenteProductFromInventory : addAchatProductFromInventory}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </div>
  )
}
