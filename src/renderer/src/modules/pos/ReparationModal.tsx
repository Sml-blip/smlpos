import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { TypeAppareil, Produit } from '../../lib/types'
import { formatPrice, generateId, generateReparationNumber } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { printLabelHtml } from '../../lib/nativePrint'
import { X, Plus, Trash2, Monitor, Bike, Smartphone, Printer as PrinterIcon, Search, Wrench, AlertTriangle } from 'lucide-react'

const api = window.api

function printFicheReparation(data: {
  numero: string; clientNom: string; clientTel: string
  typeAppareil: string; marque: string; modele: string
  panne: string; pieces: { designation: string; quantite: number; prix_achat: number; prix_unitaire: number; destock: boolean }[]
  piecesAchat: number; totalFinal: number; acompte: number; benefice: number
}) {
  const dateStr = new Date().toLocaleDateString('fr-TN')
  const lignesPieces = data.pieces.map(p =>
    `<tr><td>${p.designation}${p.destock ? ' <small>(dégât/déstock)</small>' : ''}</td><td style="text-align:center">${p.quantite}</td><td style="text-align:right">${p.prix_unitaire.toFixed(3)}</td><td style="text-align:right">${p.prix_achat.toFixed(3)}</td><td style="text-align:right">${(p.quantite * p.prix_achat).toFixed(3)}</td></tr>`
  ).join('')
  const html = `<!DOCTYPE html><html><head><title>Fiche Réparation ${data.numero}</title>
  <style>@page{size:A4;margin:15mm} body{font-family:Arial,sans-serif;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:10px} th,td{border:1px solid #ddd;padding:5px 8px}
  th{background:#f5f5f5}.total{font-weight:bold;background:#fffde7}</style></head><body>
  <h2>Fiche Réparation — ${data.numero}</h2>
  <p>Date: ${dateStr} · Client: ${data.clientNom} · Tél: ${data.clientTel}</p>
  <p>Appareil: ${data.typeAppareil} ${data.marque} ${data.modele}</p>
  <p><b>Panne:</b> ${data.panne}</p>
  <table><thead><tr><th>Pièce</th><th>Qté</th><th>Prix client</th><th>PU achat</th><th>Total achat</th></tr></thead><tbody>
  ${lignesPieces}
  <tr class="total"><td colspan="4">Pièces achat</td><td style="text-align:right">${data.piecesAchat.toFixed(3)} DT</td></tr>
  <tr class="total"><td colspan="4">Total client</td><td style="text-align:right">${data.totalFinal.toFixed(3)} DT</td></tr>
  ${data.acompte > 0 ? `<tr><td colspan="4">Acompte client (TND)</td><td style="text-align:right">${data.acompte.toFixed(3)} DT</td></tr>` : ''}
  ${data.acompte > 0 ? `<tr class="total"><td colspan="4">Reste à payer</td><td style="text-align:right">${(data.totalFinal - data.acompte).toFixed(3)} DT</td></tr>` : ''}
  <tr class="total"><td colspan="4">Bénéfice technicien</td><td style="text-align:right">${data.benefice.toFixed(3)} DT</td></tr>
  </tbody></table></body></html>`
  void printLabelHtml(html, 'A4')
}

const APPAREILS: { id: TypeAppareil; label: string; icon: React.ReactNode }[] = [
  { id: 'PC', label: 'PC', icon: <Monitor size={16} /> },
  { id: 'SCOOTER', label: 'Scooter', icon: <Bike size={16} /> },
  { id: 'SMARTPHONE', label: 'Smartphone', icon: <Smartphone size={16} /> },
  { id: 'IMPRIMANTE', label: 'Imprimante', icon: <PrinterIcon size={16} /> },
]

interface PieceInput {
  id: string
  produit_id?: string
  designation: string
  quantite: number
  prix_achat: number
  prix_unitaire: number
  destock_stock: boolean
  type: 'F' | 'NF'
  stock_actuel?: number
}

interface DegatPromptPiece {
  id: string
  designation: string
  quantite: number
  prix_achat: string
}

const parseMoney = (s: string) => parseFloat(String(s).replace(',', '.')) || 0

function DegatPriceModal({
  pieces,
  onConfirm,
  onSkip,
}: {
  pieces: DegatPromptPiece[]
  onConfirm: (updates: { id: string; prix_achat: number }[]) => void
  onSkip: () => void
}) {
  const [rows, setRows] = useState(pieces)
  const [loading, setLoading] = useState(false)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-in">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-bold flex items-center gap-2 text-orange-800">
            <AlertTriangle size={16} /> Prix des pièces dégât / incident
          </h3>
          <p className="text-xs text-text-muted mt-1">Saisissez le coût d&apos;achat ou valeur du dégât pour chaque pièce.</p>
        </div>
        <div className="p-5 space-y-3 max-h-[50vh] overflow-y-auto">
          {rows.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.designation}</div>
                <div className="text-[10px] text-text-muted">Qté {p.quantite}</div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={p.prix_achat}
                onChange={e => {
                  const u = [...rows]
                  u[i] = { ...u[i], prix_achat: e.target.value.replace(/[^0-9.,]/g, '') }
                  setRows(u)
                }}
                className="w-28 border border-border rounded-lg px-2 py-1.5 text-sm font-price text-right"
                placeholder="0.000"
                autoFocus={i === 0}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button type="button" onClick={onSkip} className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-border text-sm font-semibold">
            Plus tard
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              void runAction('Enregistrement dégâts', async () => {
                onConfirm(rows.map(r => ({ id: r.id, prix_achat: parseMoney(r.prix_achat) })))
              }, { setLoading, successMessage: 'Prix dégât enregistrés' })
            }}
            className="flex-1 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 font-bold text-sm disabled:bg-gray-200"
          >
            {loading ? '…' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [acompte, setAcompte] = useState('')
  const [totalFinal, setTotalFinal] = useState('')
  const [pieceSearch, setPieceSearch] = useState('')
  const [pieceResults, setPieceResults] = useState<Produit[]>([])
  const [loading, setLoading] = useState(false)
  const [degatPrompt, setDegatPrompt] = useState<{ repId: string; pieces: DegatPromptPiece[] } | null>(null)

  const piecesAchat = pieces.reduce((s, p) => s + p.quantite * (p.destock_stock ? 0 : p.prix_achat), 0)
  const totalFinalNum = parseMoney(totalFinal)
  const acompteNum = parseMoney(acompte)
  const benefice = totalFinalNum - piecesAchat

  const searchPieces = async (q: string) => {
    if (q.length < 2) { setPieceResults([]); return }
    const results = await loadData('Recherche pièces', () => api.produitsList({ search: q }) as Promise<Produit[]>, { silent: true })
    if (results) setPieceResults(results.slice(0, 6))
  }

  const addPiece = (p?: Produit) => {
    if (p) {
      setPieces(prev => [...prev, {
        id: generateId(),
        produit_id: p.id,
        designation: p.nom,
        quantite: 1,
        prix_achat: p.prix_achat ?? 0,
        prix_unitaire: p.prix_vente ?? 0,
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
        destock_stock: false,
        type: 'NF',
      }])
    }
    setPieceSearch('')
    setPieceResults([])
  }

  const canSave = panne.trim() && pieces.length > 0 && totalFinalNum > 0

  const finishClose = () => {
    setDegatPrompt(null)
    onClose()
  }

  const handleSave = async () => {
    if (!canSave) return
    await runAction('Création réparation', async () => {
      const prefix = `REP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      const lastNum = await api.reparationsGetLastNumber(prefix) as number
      const numero = generateReparationNumber(lastNum)
      const repId = generateId()
      const now = new Date().toISOString()

      const piecesForSave = pieces.map(p => ({
        ...p,
        prix_achat: p.destock_stock ? 0 : p.prix_achat,
      }))
      const mainOeuvre = piecesForSave.reduce((s, p) => s + p.quantite * p.prix_achat, 0)

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
        acompte: acompteNum,
        total_estime: totalFinalNum,
        total_final: totalFinalNum,
        benefice: totalFinalNum - mainOeuvre,
        statut: 'EN_ATTENTE',
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

      const degatPieces = pieces.filter(p => p.destock_stock)
      if (degatPieces.length > 0) {
        setDegatPrompt({
          repId,
          pieces: degatPieces.map(p => ({
            id: p.id,
            designation: p.designation,
            quantite: p.quantite,
            prix_achat: '',
          })),
        })
      } else {
        onClose()
      }
    }, { setLoading, successMessage: 'Réparation créée' })
  }

  if (degatPrompt) {
    return (
      <DegatPriceModal
        pieces={degatPrompt.pieces}
        onSkip={finishClose}
        onConfirm={async updates => {
          await api.reparationsApplyDegatPrices?.(degatPrompt.repId, updates)
          finishClose()
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-bold flex items-center gap-2"><Wrench size={16} /> Nouvelle Réparation</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nom client</label>
              <input value={clientNom} onChange={e => setClientNom(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Téléphone</label>
              <input value={clientTel} onChange={e => setClientTel(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
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

          <div className="grid grid-cols-2 gap-4">
            <input value={marque} onChange={e => setMarque(e.target.value)} placeholder="Marque" className="border border-border rounded-lg px-3 py-2 text-sm" />
            <input value={modele} onChange={e => setModele(e.target.value)} placeholder="Modèle" className="border border-border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description de la panne *</label>
            <textarea value={panne} onChange={e => setPanne(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm h-20 resize-none" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-secondary">Pièces / composants</label>
              <button type="button" onClick={() => addPiece()} className="text-xs text-accent-600 font-semibold flex items-center gap-1"><Plus size={12} /> Ligne libre</button>
            </div>
            <div className="relative mb-2">
              <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted">
                <Search size={13} className="text-text-muted" />
                <input value={pieceSearch} onChange={e => { setPieceSearch(e.target.value); void searchPieces(e.target.value) }}
                  className="flex-1 bg-transparent text-sm outline-none" placeholder="Rechercher stock ou saisir une ligne libre…" />
              </div>
              {pieceResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-border rounded-lg shadow-lg mt-1">
                  {pieceResults.map(p => (
                    <button key={p.id} type="button" onClick={() => addPiece(p)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-sm border-b last:border-0">
                      <span className={p.type === 'F' ? 'badge-F' : 'badge-NF'}>{p.type}</span>
                      <span className="flex-1 truncate">{p.nom}</span>
                      <span className="text-xs text-text-muted">Stock: {p.stock_actuel}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pieces.map((p, i) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 mb-2 p-2 border border-border rounded-lg bg-muted/30">
                <input value={p.designation} onChange={e => { const u = [...pieces]; u[i].designation = e.target.value; setPieces(u) }}
                  className="flex-1 min-w-[100px] border border-border rounded-lg px-2 py-1.5 text-sm" placeholder="Désignation" />
                <input type="text" inputMode="numeric" value={p.quantite} onChange={e => { const u = [...pieces]; u[i].quantite = parseInt(e.target.value.replace(/\D/g, '')) || 1; setPieces(u) }}
                  className="w-11 border border-border rounded-lg px-2 py-1.5 text-sm text-center" title="Qté" />
                <input type="text" inputMode="decimal" value={p.prix_unitaire || ''} onChange={e => { const u = [...pieces]; u[i].prix_unitaire = parseMoney(e.target.value); setPieces(u) }}
                  className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm font-price" title="Prix pièce client (TND)" placeholder="Prix client" />
                <input type="text" inputMode="decimal" value={p.destock_stock ? '' : (p.prix_achat || '')}
                  disabled={p.destock_stock}
                  onChange={e => { const u = [...pieces]; u[i].prix_achat = parseMoney(e.target.value); setPieces(u) }}
                  className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm font-price disabled:bg-gray-100 disabled:text-text-muted"
                  title={p.destock_stock ? 'Prix dégât saisi après enregistrement' : 'Prix achat TND'} placeholder={p.destock_stock ? 'Après submit' : 'Prix achat'} />
                <label className="flex items-center gap-1 text-[10px] font-semibold text-orange-700 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={p.destock_stock} onChange={e => { const u = [...pieces]; u[i].destock_stock = e.target.checked; if (e.target.checked) u[i].prix_achat = 0; setPieces(u) }} />
                  <AlertTriangle size={11} /> Dégât
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
              <input type="text" inputMode="decimal" value={acompte} onChange={e => setAcompte(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-price" placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Total client (TND) *</label>
              <input type="text" inputMode="decimal" value={totalFinal} onChange={e => setTotalFinal(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full border border-accent-400 rounded-lg px-3 py-2 text-sm font-price font-bold" placeholder="0.000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bénéfice technicien</label>
              <div className={`border rounded-lg px-3 py-2 font-price font-bold text-sm ${benefice >= 0 ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
                {benefice >= 0 ? '+' : ''}{formatPrice(benefice)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border font-semibold py-2.5 rounded-xl">Annuler</button>
          <button type="button" onClick={() => printFicheReparation({
            numero: 'BROUILLON', clientNom, clientTel, typeAppareil, marque, modele, panne,
            pieces: pieces.map(p => ({ designation: p.designation, quantite: p.quantite, prix_achat: p.prix_achat, prix_unitaire: p.prix_unitaire, destock: p.destock_stock })),
            piecesAchat, totalFinal: totalFinalNum, acompte: acompteNum, benefice,
          })} className="px-4 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold flex items-center gap-1">
            <PrinterIcon size={14} /> Aperçu
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave || loading}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 font-bold py-2.5 rounded-xl">
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
