import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { TypeAppareil, Produit } from '../../lib/types'
import { formatPrice, generateId, generateReparationNumber } from '../../lib/utils'
import { runAction } from '../../lib/apiCall'
import ClientPicker, { emptyClientForm, type ClientFormValue } from '../../components/ClientPicker'
import InventoryProductPickerModal from '../../components/InventoryProductPickerModal'
import { printLabelHtml } from '../../lib/nativePrint'
import { X, Plus, Trash2, Monitor, Bike, Smartphone, Printer as PrinterIcon, Wrench, PackageSearch } from 'lucide-react'

const api = window.api

function printFicheReparation(data: {
  numero: string; clientNom: string; clientTel: string
  typeAppareil: string; marque: string; modele: string
  panne: string; pieces: { designation: string; quantite: number; prix_achat: number; destock: boolean }[]
  piecesAchat: number; totalFinal: number; acompte: number; benefice: number
}) {
  const dateStr = new Date().toLocaleDateString('fr-TN')
  const lignesPieces = data.pieces.map(p =>
    `<tr><td>${p.designation}${p.destock ? ' <small>(dégât/déstock)</small>' : ''}</td><td style="text-align:center">${p.quantite}</td><td style="text-align:right">${p.prix_achat.toFixed(3)}</td><td style="text-align:right">${(p.quantite * p.prix_achat).toFixed(3)}</td></tr>`
  ).join('')
  const html = `<!DOCTYPE html><html><head><title>Fiche Réparation ${data.numero}</title>
  <style>@page{size:A4;margin:15mm} body{font-family:Arial,sans-serif;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:10px} th,td{border:1px solid #ddd;padding:5px 8px}
  th{background:#f5f5f5}.total{font-weight:bold;background:#fffde7}</style></head><body>
  <h2>Fiche Réparation — ${data.numero}</h2>
  <p>Date: ${dateStr} · Client: ${data.clientNom} · Tél: ${data.clientTel}</p>
  <p>Appareil: ${data.typeAppareil} ${data.marque} ${data.modele}</p>
  <p><b>Panne:</b> ${data.panne}</p>
  <table><thead><tr><th>Pièce</th><th>Qté</th><th>Prix achat</th><th>Total achat</th></tr></thead><tbody>
  ${lignesPieces}
  <tr class="total"><td colspan="3">Pièces achat</td><td style="text-align:right">${data.piecesAchat.toFixed(3)} DT</td></tr>
  <tr class="total"><td colspan="3">Total client</td><td style="text-align:right">${data.totalFinal.toFixed(3)} DT</td></tr>
  ${data.acompte > 0 ? `<tr><td colspan="3">Acompte client (TND)</td><td style="text-align:right">${data.acompte.toFixed(3)} DT</td></tr>` : ''}
  ${data.acompte > 0 ? `<tr class="total"><td colspan="3">Reste à payer</td><td style="text-align:right">${(data.totalFinal - data.acompte).toFixed(3)} DT</td></tr>` : ''}
  <tr class="total"><td colspan="3">Bénéfice technicien</td><td style="text-align:right">${data.benefice.toFixed(3)} DT</td></tr>
  </tbody></table></body></html>`
  void printLabelHtml(html, 'A4')
}

const APPAREILS: { id: TypeAppareil; label: string; icon: React.ReactNode }[] = [
  { id: 'PC', label: 'PC', icon: <Monitor size={16} /> },
  { id: 'SCOOTER', label: 'Scooter', icon: <Bike size={16} /> },
  { id: 'SMARTPHONE', label: 'Smartphone', icon: <Smartphone size={16} /> },
  { id: 'IMPRIMANTE', label: 'Imprimante', icon: <PrinterIcon size={16} /> },
]

const PANNES: Record<TypeAppareil, string[]> = {
  SMARTPHONE: ['Afficheur / Écran', 'Connecteur de charge', 'Micro', 'Haut-parleur', 'Carte de charge', 'Batterie', 'Caméra avant / arrière', 'Bouton power / volume', 'Carte mère', 'Réseau / Signal', 'Wi-Fi / Bluetooth', 'Oxydation / Eau', 'Flash / FRP', 'Autre'],
  PC: ['Écran cassé / LCD', 'Clavier défectueux', 'Batterie faible / HS', 'Chargeur ne fonctionne pas', 'Port de charge', 'Disque dur / SSD', 'RAM défectueuse', 'Surchauffe', 'Ventilateur', 'Carte mère', 'Windows ne démarre pas', 'Virus / lenteur', 'Formatage + Windows', 'Autre'],
  IMPRIMANTE: ['Encre non détectée', 'Cartouche vide', 'Bourrage papier', "Tête d'impression", 'Impression pâle', 'Connectivité Wi-Fi', 'Tambour', 'Unité de chauffe', 'Scanner ne fonctionne pas', 'Maintenance / nettoyage', 'Autre'],
  SCOOTER: ['Batterie ne charge pas', 'Autonomie faible', "Scooter ne s'allume pas", 'Moteur ne fonctionne pas', 'Vitesse faible', 'Problème de frein', 'Pneu crevé', 'Écran ne fonctionne pas', 'Contrôleur', 'Chargeur ne fonctionne pas', 'Autre'],
}

interface PieceInput {
  id: string
  produit_id?: string
  designation: string
  quantite: number
  prix_achat: number
  prix_unitaire: number
  prix_achat_input?: string
  destock_stock: boolean
  type: 'F' | 'NF'
  stock_actuel?: number
}

const parseMoney = (s: string) => parseFloat(String(s).replace(',', '.')) || 0
const sanitizeMoneyInput = (s: string) => s.replace(/[^0-9.,]/g, '')
const formatMoneyInput = (n: number) => (n ? String(n) : '')

export default function ReparationModal({ onClose }: { onClose: () => void }) {
  const { currentShift } = useAppStore()
  const [clientForm, setClientForm] = useState<ClientFormValue>(emptyClientForm())
  const [typeAppareil, setTypeAppareil] = useState<TypeAppareil>('SMARTPHONE')
  const [marque, setMarque] = useState('')
  const [modele, setModele] = useState('')
  const [panne, setPanne] = useState('')
  const [customPanne, setCustomPanne] = useState('')
  const [estimatedCompletion, setEstimatedCompletion] = useState('')
  const [pieces, setPieces] = useState<PieceInput[]>([])
  const [acompte, setAcompte] = useState('')
  const [totalFinal, setTotalFinal] = useState('')
  const [loading, setLoading] = useState(false)
  const [showInventoryPicker, setShowInventoryPicker] = useState(false)

  const piecesAchat = pieces.reduce((s, p) => s + p.quantite * p.prix_achat, 0)
  const totalFinalNum = parseMoney(totalFinal)
  const acompteNum = parseMoney(acompte)
  const benefice = totalFinalNum - piecesAchat

  const addPiece = (p?: Produit) => {
    if (p) {
      setPieces(prev => [...prev, {
        id: generateId(),
        produit_id: p.id,
        designation: p.nom,
        quantite: 1,
        prix_achat: p.prix_achat ?? 0,
        prix_unitaire: 0,
        prix_achat_input: formatMoneyInput(p.prix_achat ?? 0),
        destock_stock: false,
        type: p.type,
        stock_actuel: p.stock_actuel,
      }])
    } else {
      setPieces(prev => [...prev, {
        id: generateId(),
        designation: '',
        quantite: 1,
        prix_achat: 0,
        prix_unitaire: 0,
        prix_achat_input: '',
        destock_stock: false,
        type: 'NF',
      }])
    }
  }

  const updatePiece = (index: number, patch: Partial<PieceInput>) => {
    setPieces(prev => prev.map((piece, i) => (i === index ? { ...piece, ...patch } : piece)))
  }

  const validPieces = pieces.every(p => p.designation.trim() && p.quantite > 0 && p.prix_achat >= 0)
  const panneFinale = panne === 'Autre' ? customPanne.trim() : panne.trim()
  const canSave = !!clientForm.nom.trim() && !!clientForm.tel.trim() && !!panneFinale && validPieces

  const handleSave = async () => {
    if (!canSave) return
    await runAction('Création réparation', async () => {
      const prefix = `REP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      const lastNum = await api.reparationsGetLastNumber(prefix) as number
      const numero = generateReparationNumber(lastNum)
      const repId = generateId()
      const now = new Date().toISOString()

      const piecesForSave = pieces.map(p => ({ ...p }))
      const mainOeuvre = piecesForSave.reduce((s, p) => s + p.quantite * p.prix_achat, 0)

      const rep = {
        id: repId,
        numero,
        repair_token: numero,
        shift_id: currentShift?.id ?? null,
        operateur_nom: currentShift?.operateur_nom ?? null,
        client_nom: clientForm.nom || null,
        client_tel: clientForm.tel || null,
        type_appareil: typeAppareil,
        marque: marque || null,
        modele: modele || null,
        description_panne: panneFinale,
        main_oeuvre: mainOeuvre,
        acompte: acompteNum,
        total_estime: totalFinalNum,
        total_final: 0,
        benefice: 0,
        statut: 'EN_ATTENTE',
        estimated_completion: estimatedCompletion ? new Date(estimatedCompletion).toISOString() : null,
        created_at: now,
        updated_at: now,
      }

      const piecesData = piecesForSave.map(p => ({
        id: p.id,
        reparation_id: repId,
        produit_id: p.produit_id || null,
        designation: p.designation,
        quantite: p.quantite,
        prix_unitaire: p.prix_unitaire,
        prix_achat: p.prix_achat,
        destock_stock: p.destock_stock ? 1 : 0,
        type: p.type,
      }))

      await api.reparationsCreate(rep, piecesData)

      onClose()
    }, { setLoading, successMessage: 'Réparation créée' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold flex items-center gap-2"><Wrench size={16} /> Nouvelle Réparation</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          <ClientPicker compact value={clientForm} onChange={setClientForm} />

          <div className="rounded-xl border border-border p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">Appareil et panne</h3>
            <label className="block text-xs font-semibold text-text-secondary mb-2">Type d&apos;appareil</label>
            <div className="flex gap-2 flex-wrap">
              {APPAREILS.map(a => (
                <button key={a.id} type="button" onClick={() => setTypeAppareil(a.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium ${typeAppareil === a.id ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'}`}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 -mt-2 px-4">
            <input value={marque} onChange={e => setMarque(e.target.value)} placeholder="Marque" className="border border-border rounded-lg px-3 py-2 text-sm" />
            <input value={modele} onChange={e => setModele(e.target.value)} placeholder="Modèle" className="border border-border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="px-4 -mt-2">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description de la panne *</label>
            <select value={panne} onChange={e => setPanne(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Sélectionnez un problème…</option>
              {PANNES[typeAppareil].map(problem => <option key={problem} value={problem}>{problem}</option>)}
            </select>
            {panne === 'Autre' && <textarea value={customPanne} onChange={e => setCustomPanne(e.target.value)} className="mt-2 w-full border border-border rounded-lg px-3 py-2 text-sm h-20 resize-none" placeholder="Décrivez le problème…" autoFocus />}
          </div>

          <div className="px-4 -mt-2">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Temps estimé (optionnel)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {[['2 h', 2], ['4 h', 4], ['Demain', 24], ['2 jours', 48], ['1 semaine', 168]].map(([label, hours]) => (
                <button key={String(label)} type="button" onClick={() => { const d = new Date(Date.now() + Number(hours) * 3600000); setEstimatedCompletion(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }}
                  className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold hover:border-accent-500 hover:bg-accent-50">{label}</button>
              ))}
            </div>
            <input type="datetime-local" value={estimatedCompletion} onChange={e => setEstimatedCompletion(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-xs font-semibold text-text-secondary">Pièces / composants (optionnel)</label>
                <p className="text-[10px] text-text-muted mt-0.5">Ajoutez uniquement les pièces utilisées pour calculer le coût et le bénéfice.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowInventoryPicker(true)} className="text-xs text-blue-700 font-semibold flex items-center gap-1">
                  <PackageSearch size={12} /> Depuis le stock
                </button>
                <button type="button" onClick={() => addPiece()} className="text-xs text-accent-600 font-semibold flex items-center gap-1"><Plus size={12} /> Ligne libre</button>
              </div>
            </div>
            {pieces.map((p, i) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 mb-2 p-2 border border-border rounded-lg bg-muted/30">
                <input value={p.designation} onChange={e => updatePiece(i, { designation: e.target.value })}
                  className="flex-1 min-w-[100px] border border-border rounded-lg px-2 py-1.5 text-sm" placeholder="Désignation" />
                <input type="text" inputMode="numeric" value={p.quantite} onChange={e => updatePiece(i, { quantite: parseInt(e.target.value.replace(/\D/g, '')) || 1 })}
                  className="w-11 border border-border rounded-lg px-2 py-1.5 text-sm text-center" title="Qté" />
                <input type="text" inputMode="decimal" value={p.prix_achat_input ?? formatMoneyInput(p.prix_achat)}
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => { const val = sanitizeMoneyInput(e.target.value); updatePiece(i, { prix_achat_input: val, prix_achat: parseMoney(val) }) }}
                  className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm font-price"
                  title="Prix achat TND" placeholder="Prix achat" />
                <label className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={p.destock_stock} onChange={e => updatePiece(i, { destock_stock: e.target.checked })} />
                  Déduire du stock
                </label>
                {p.produit_id && p.destock_stock && (
                  <span className="text-[10px] text-text-muted">Stock: {p.stock_actuel ?? '?'}</span>
                )}
                <button type="button" onClick={() => setPieces(pieces.filter((_, j) => j !== i))} className="text-danger"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Pièces achat (TND)</label>
              <div className="border border-border bg-muted rounded-lg px-3 py-2 font-price text-sm">{formatPrice(piecesAchat)}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Acompte client (TND)</label>
              <input type="text" inputMode="decimal" value={acompte} onFocus={e => e.currentTarget.select()} onChange={e => setAcompte(sanitizeMoneyInput(e.target.value))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price" placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Prix estimé (TND, optionnel)</label>
              <input type="text" inputMode="decimal" value={totalFinal} onFocus={e => e.currentTarget.select()} onChange={e => setTotalFinal(sanitizeMoneyInput(e.target.value))}
                className="w-full border border-accent-400 rounded-lg px-3 py-2 text-sm font-price font-bold" placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bénéfice estimé</label>
              <div className={`border rounded-lg px-3 py-2 font-price font-bold text-sm ${benefice >= 0 ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
                {totalFinalNum > 0 ? `${benefice >= 0 ? '+' : ''}${formatPrice(benefice)}` : '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl">Fermer</button>
          <button type="button" onClick={() => printFicheReparation({
            numero: 'BROUILLON', clientNom: clientForm.nom, clientTel: clientForm.tel, typeAppareil, marque, modele, panne: panneFinale,
            pieces: pieces.map(p => ({ designation: p.designation, quantite: p.quantite, prix_achat: p.prix_achat, destock: p.destock_stock })),
            piecesAchat, totalFinal: totalFinalNum, acompte: acompteNum, benefice,
          })} className="px-4 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold flex items-center gap-1">
            <PrinterIcon size={14} /> Aperçu
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave || loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 font-bold py-2.5 rounded-xl">
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        {!canSave && (
          <p className="px-6 pb-3 text-[10px] text-text-muted text-right">Nom, téléphone et description de panne sont requis. Le prix et les pièces peuvent être ajoutés plus tard.</p>
        )}
      </div>
      {showInventoryPicker && (
        <InventoryProductPickerModal
          title="Add repair part from inventory"
          productFilter="all"
          onAddProduct={addPiece}
          onClose={() => setShowInventoryPicker(false)}
        />
      )}
    </div>
  )
}
