import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { TypeAppareil, Produit } from '../../lib/types'
import { formatPrice, generateId, generateReparationNumber } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { printLabelHtml } from '../../lib/nativePrint'
import { X, Plus, Trash2, Monitor, Bike, Smartphone, Printer as PrinterIcon, Search, Wrench } from 'lucide-react'

const api = window.api

function printFicheReparation(data: {
  numero: string; clientNom: string; clientTel: string
  typeAppareil: string; marque: string; modele: string
  panne: string; pieces: { designation: string; quantite: number; prix_unitaire: number }[]
  mainOeuvre: number; totalFinal: number; acompte: number
}) {
  const dateStr = new Date().toLocaleDateString('fr-TN')
  const lignesPieces = data.pieces.map(p =>
    `<tr><td>${p.designation}</td><td style="text-align:center">${p.quantite}</td><td style="text-align:right">${p.prix_unitaire.toFixed(3)}</td><td style="text-align:right">${(p.quantite * p.prix_unitaire).toFixed(3)}</td></tr>`
  ).join('')
  const html = `<!DOCTYPE html><html><head><title>Fiche Réparation ${data.numero}</title>
  <style>
    @page{size:A4;margin:15mm} body{font-family:Arial,sans-serif;font-size:12px}
    h2{font-size:16px;margin:0 0 4px} .sub{color:#555;margin-bottom:12px;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
    th{background:#f5f5f5;border:1px solid #ccc;padding:5px 8px;text-align:left}
    td{border:1px solid #ddd;padding:5px 8px}
    .total{font-weight:bold;background:#fffde7} .info{margin-bottom:8px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  </style></head><body>
  <h2>Fiche Réparation — ${data.numero}</h2>
  <div class="sub">Date: ${dateStr}</div>
  <div class="grid">
    <div class="info"><b>Client :</b> ${data.clientNom}</div>
    <div class="info"><b>Téléphone :</b> ${data.clientTel}</div>
    <div class="info"><b>Appareil :</b> ${data.typeAppareil}</div>
    <div class="info"><b>Marque / Modèle :</b> ${data.marque} ${data.modele}</div>
  </div>
  <div class="info"><b>Panne décrite :</b> ${data.panne}</div>
  <table>
    <thead><tr><th>Pièce / Prestation</th><th style="text-align:center">Qté</th><th style="text-align:right">PU</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${lignesPieces}<tr class="total"><td colspan="3"><b>Total client</b></td><td style="text-align:right"><b>${data.totalFinal.toFixed(3)} DT</b></td></tr>
    ${data.acompte > 0 ? `<tr><td colspan="3">Acompte versé</td><td style="text-align:right">${data.acompte.toFixed(3)} DT</td></tr>` : ''}
    ${data.acompte > 0 ? `<tr class="total"><td colspan="3"><b>Reste à payer</b></td><td style="text-align:right"><b>${(data.totalFinal - data.acompte).toFixed(3)} DT</b></td></tr>` : ''}
    </tbody>
  </table>
  <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
    <div><div style="border-top:1px solid #000;padding-top:4px;font-size:11px">Signature technicien</div></div>
    <div><div style="border-top:1px solid #000;padding-top:4px;font-size:11px">Signature client</div></div>
  </div>
  </body></html>`
  void printLabelHtml(html)
}

const APPAREILS: { id: TypeAppareil; label: string; icon: React.ReactNode }[] = [
  { id: 'PC', label: 'PC', icon: <Monitor size={16} /> },
  { id: 'SCOOTER', label: 'Scooter', icon: <Bike size={16} /> },
  { id: 'SMARTPHONE', label: 'Smartphone', icon: <Smartphone size={16} /> },
  { id: 'IMPRIMANTE', label: 'Imprimante', icon: <PrinterIcon size={16} /> },
]

interface PieceInput {
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  type: 'F' | 'NF'
}

export default function ReparationModal({ onClose }: { onClose: () => void }) {
  const { currentShift } = useAppStore()
  const [clientNom, setClientNom] = useState('')
  const [clientTel, setClientTel] = useState('')
  const [typeAppareil, setTypeAppareil] = useState<TypeAppareil>('SMARTPHONE')
  const [marque, setMarque] = useState('')
  const [modele, setModele] = useState('')
  const [panne, setPanne] = useState('')
  const [pieces, setPieces] = useState<PieceInput[]>([])
  const [acompte, setAcompte] = useState('0')
  const [totalFinal, setTotalFinal] = useState('0')
  const [pieceSearch, setPieceSearch] = useState('')
  const [pieceResults, setPieceResults] = useState<Produit[]>([])
  const [loading, setLoading] = useState(false)

  // main_oeuvre = sum of all pieces (auto-calculated)
  const mainOeuvre = pieces.reduce((s, p) => s + p.quantite * p.prix_unitaire, 0)
  const totalFinalNum = parseFloat(totalFinal) || 0
  const benefice = totalFinalNum - mainOeuvre

  const searchPieces = async (q: string) => {
    if (q.length < 2) { setPieceResults([]); return }
    const results = await loadData('Recherche pièces', () => api.produitsList({ search: q }) as Promise<Produit[]>, { silent: true })
    if (results) setPieceResults(results.slice(0, 6))
  }

  const addPiece = (p?: Produit) => {
    if (p) {
      setPieces(prev => [...prev, { produit_id: p.id, designation: p.nom, quantite: 1, prix_unitaire: p.prix_vente, type: p.type }])
    } else {
      setPieces(prev => [...prev, { designation: '', quantite: 1, prix_unitaire: 0, type: 'NF' }])
    }
    setPieceSearch('')
    setPieceResults([])
  }

  const canSave = panne.trim() && mainOeuvre > 0 && totalFinalNum > 0

  const handleSave = async () => {
    if (!canSave) return
    await runAction('Création réparation', async () => {
      const prefix = `REP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      const lastNum = await api.reparationsGetLastNumber(prefix) as number
      const numero = generateReparationNumber(lastNum)
      const repId = generateId()

      const now = new Date().toISOString()
      const rep = {
        id: repId,
        numero,
        shift_id: currentShift?.id ?? null,
        operateur_nom: currentShift?.operateur_nom ?? null,
        client_nom: clientNom || null,
        client_tel: clientTel || null,
        type_appareil: typeAppareil,
        marque: marque || null,
        modele: modele || null,
        description_panne: panne,
        main_oeuvre: mainOeuvre,
        acompte: parseFloat(acompte) || 0,
        total_estime: totalFinalNum,
        total_final: totalFinalNum,
        benefice: benefice,
        statut: 'EN_ATTENTE',
        created_at: now,
        updated_at: now,
      }

      const piecesData = pieces.map(p => ({
        id: generateId(),
        reparation_id: repId,
        produit_id: p.produit_id || null,
        designation: p.designation,
        quantite: p.quantite,
        prix_unitaire: p.prix_unitaire,
        type: p.type,
      }))

      await api.reparationsCreate(rep, piecesData)
      onClose()
    }, { setLoading, successMessage: 'Réparation créée' })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="font-bold flex items-center gap-2"><Wrench size={16} /> Nouvelle Réparation</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Client */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom client</label>
              <input value={clientNom} onChange={e => setClientNom(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Nom du client..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Téléphone</label>
              <input value={clientTel} onChange={e => setClientTel(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="+216..." />
            </div>
          </div>

          {/* Appareil */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-2">Type d'appareil</label>
            <div className="flex gap-2 flex-wrap">
              {APPAREILS.map(a => (
                <button key={a.id} onClick={() => setTypeAppareil(a.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${typeAppareil === a.id ? 'border-accent-500 bg-accent-50 text-text-primary' : 'border-border hover:bg-muted text-text-secondary'}`}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Marque/Modèle */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Marque</label>
              <input value={marque} onChange={e => setMarque(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Samsung, Apple..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Modèle</label>
              <input value={modele} onChange={e => setModele(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Galaxy A54..." />
            </div>
          </div>

          {/* Panne */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description de la panne <span className="text-danger">*</span></label>
            <textarea value={panne} onChange={e => setPanne(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm h-20 resize-none" placeholder="Décrire le problème..." />
          </div>

          {/* Pièces */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-secondary">Pièces utilisées</label>
              <button onClick={() => addPiece()} className="text-xs text-accent-600 font-semibold flex items-center gap-1 hover:text-accent-500">
                <Plus size={12} /> Ajouter libre
              </button>
            </div>

            {/* Search pieces */}
            <div className="relative mb-2">
              <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted">
                <Search size={13} className="text-text-muted" />
                <input
                  value={pieceSearch}
                  onChange={e => { setPieceSearch(e.target.value); searchPieces(e.target.value) }}
                  className="flex-1 bg-transparent text-sm outline-none"
                  placeholder="Rechercher dans le stock..."
                />
              </div>
              {pieceResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-border rounded-lg shadow-lg mt-1">
                  {pieceResults.map(p => (
                    <button key={p.id} onClick={() => addPiece(p)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-sm border-b border-border last:border-0">
                      <span className={p.type === 'F' ? 'badge-F' : 'badge-NF'}>{p.type}</span>
                      <span className="flex-1 truncate">{p.nom}</span>
                      <span className="font-price text-xs">{formatPrice(p.prix_vente)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pieces.map((p, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input value={p.designation} onChange={e => { const u = [...pieces]; u[i].designation = e.target.value; setPieces(u) }} className="flex-1 border border-border rounded-lg px-2 py-1.5 text-sm" placeholder="Désignation..." />
                <input type="text" inputMode="numeric" value={p.quantite} onChange={e => { const u = [...pieces]; u[i].quantite = parseInt(e.target.value.replace(/[^0-9]/g, '')) || 1; setPieces(u) }} className="w-14 border border-border rounded-lg px-2 py-1.5 text-sm font-price text-center" />
                <input type="text" inputMode="decimal" value={p.prix_unitaire} onChange={e => { const u = [...pieces]; u[i].prix_unitaire = parseFloat(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0; setPieces(u) }} className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm font-price" />
                <button onClick={() => setPieces(pieces.filter((_, j) => j !== i))} className="text-danger hover:text-red-700"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          {/* Financials */}
          {!panne.trim() && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Description de la panne obligatoire.</p>}
          {panne.trim() && mainOeuvre === 0 && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Ajoutez au moins une pièce avant de sauvegarder.</p>}
          {panne.trim() && mainOeuvre > 0 && totalFinalNum === 0 && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Le total client doit être supérieur à zéro.</p>}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Pièces (DT)</label>
              <div className={`border bg-muted rounded-lg px-3 py-2 font-price text-sm ${mainOeuvre === 0 ? 'border-red-300 text-red-600' : 'border-border text-text-muted'}`}>{formatPrice(mainOeuvre)}</div>
              <p className="text-[10px] text-text-muted mt-0.5">Auto-calculé</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Acompte (DT)</label>
              <input type="text" inputMode="decimal" value={acompte} onChange={e => setAcompte(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Total client (DT) <span className="text-danger">*</span></label>
              <input type="text" inputMode="decimal" value={totalFinal} onChange={e => setTotalFinal(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} className="w-full border border-accent-400 rounded-lg px-3 py-2 text-sm font-price font-bold" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bénéfice</label>
              <div className={`border rounded-lg px-3 py-2 font-price font-bold text-sm ${benefice >= 0 ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
                {benefice >= 0 ? '+' : ''}{formatPrice(benefice)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors">Annuler</button>
          <button
            onClick={() => printFicheReparation({
              numero: 'BROUILLON', clientNom, clientTel,
              typeAppareil, marque, modele, panne,
              pieces: pieces.map(p => ({ designation: p.designation, quantite: p.quantite, prix_unitaire: p.prix_unitaire })),
              mainOeuvre, totalFinal: parseFloat(totalFinal) || 0, acompte: parseFloat(acompte) || 0,
            })}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-muted hover:bg-border border border-border text-text-primary font-semibold rounded-xl text-sm transition-colors"
          >
            <PrinterIcon size={14} /> Aperçu
          </button>
          <button onClick={handleSave} disabled={!canSave || loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors">
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
