import { useState, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import type { CartItem, Vente } from '../../lib/types'
import { formatPrice, generateId } from '../../lib/utils'
import { runAction } from '../../lib/apiCall'
import { X, FileText, Printer, CheckCircle } from 'lucide-react'
import PrintDialog from '../../components/PrintDialog'

const api = window.api

interface Props {
  items: CartItem[]
  vente?: Vente
  onClose: () => void
  onSuccess?: () => void
  initialClientNom?: string
  initialClientTel?: string
  initialClientAdresse?: string
  initialClientMatricule?: string
}

export default function FactureClientModal({ items, vente, onClose, onSuccess, initialClientNom = '', initialClientTel = '', initialClientAdresse = '', initialClientMatricule = '' }: Props) {
  const { currentShift } = useAppStore()
  const [clientNom, setClientNom] = useState(initialClientNom)
  const [clientTel, setClientTel] = useState(initialClientTel)
  const [clientAdresse, setClientAdresse] = useState(initialClientAdresse)
  const [clientMatricule, setClientMatricule] = useState(initialClientMatricule)
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [factureNumero, setFactureNumero] = useState('')
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const lignesF = items.filter(item => item.type_produit === 'F')
  const totalHT = lignesF.reduce((s, i) => s + i.total_ligne, 0)
  const totalTVA = 0
  const totalTTC = totalHT + totalTVA

  const handleGenerate = async () => {
    if (!clientNom.trim()) return
    await runAction('Génération facture', async () => {
      const now = new Date().toISOString()
      const year = new Date().getFullYear()
      const yy = String(year).slice(-2)
      const seqKey = `facture_vente_sequence_${year}`
      const prevSeqRaw = await api.settingsGet(seqKey) as string | null
      const prevSeq = parseInt(prevSeqRaw ?? '0') || 0
      const nextSeq = prevSeq + 1
      await api.settingsSet(seqKey, String(nextSeq))
      const numero = `${yy}/#${String(nextSeq).padStart(5, '0')}`

      const facture = {
        id: generateId(),
        numero,
        shift_id: currentShift?.id,
        vente_id: vente?.id ?? null,
        type_facture: 'VENTE_INDIVIDUELLE',
        client_nom: clientNom.trim(),
        client_tel: clientTel.trim() || null,
        client_adresse: clientAdresse.trim() || null,
        client_matricule: clientMatricule.trim() || null,
        total_ht: totalHT,
        total_tva: totalTVA,
        total_ttc: totalTTC,
        created_at: now,
      }
      const lignes = lignesF.map(item => ({
        id: generateId(),
        facture_id: facture.id,
        vente_id: vente?.id ?? null,
        designation: item.designation,
        quantite: item.quantite,
        prix_unitaire: item.prix_unitaire,
        remise_pct: item.remise_pct,
        tva_taux: 0,
        total_ht: item.total_ligne,
        total_tva: 0,
        total_ttc: item.total_ligne,
      }))

      await api.facturesClientsCreate(facture, lignes)
      setFactureNumero(numero)
      setGenerated(true)
      onSuccess?.()
    }, { setLoading, successMessage: 'Facture générée' })
  }

  const printPreview = (
    <div ref={printRef}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>FACTURE</h1>
      <div style={{ marginBottom: 16 }}>
        <strong>N° :</strong> {factureNumero}<br />
        <strong>Client :</strong> {clientNom}<br />
        <strong>Date :</strong> {new Date().toLocaleDateString('fr-FR')}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ background: '#f0f0f0', padding: '6px 8px', textAlign: 'left', border: '1px solid #ccc', fontSize: 11 }}>Désignation</th>
            <th style={{ background: '#f0f0f0', padding: '6px 8px', textAlign: 'center', border: '1px solid #ccc', fontSize: 11 }}>Qté</th>
            <th style={{ background: '#f0f0f0', padding: '6px 8px', textAlign: 'right', border: '1px solid #ccc', fontSize: 11 }}>P.U. (DT)</th>
            <th style={{ background: '#f0f0f0', padding: '6px 8px', textAlign: 'right', border: '1px solid #ccc', fontSize: 11 }}>Total (DT)</th>
          </tr>
        </thead>
        <tbody>
          {lignesF.map((i, idx) => (
            <tr key={idx}>
              <td style={{ padding: '5px 8px', border: '1px solid #ddd', fontSize: 11 }}>{i.designation}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ddd', fontSize: 11, textAlign: 'center' }}>{i.quantite}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ddd', fontSize: 11, textAlign: 'right' }}>{i.prix_unitaire.toFixed(3)}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ddd', fontSize: 11, textAlign: 'right' }}>{i.total_ligne.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 14, fontWeight: 'bold', textAlign: 'right', marginTop: 12 }}>
        Total TTC : {totalTTC.toFixed(3)} DT
      </div>
    </div>
  )

  if (generated) {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130]">
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] animate-slide-in">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-success" />
              </div>
              <h2 className="font-bold text-xl text-text-primary mb-2">Facture générée</h2>
              <p className="text-text-secondary text-sm mb-1">Référence :</p>
              <p className="font-price font-bold text-lg text-text-primary mb-6">{factureNumero}</p>
              <p className="text-sm text-text-secondary mb-6">
                Client : <strong>{clientNom}</strong><br />
                Montant TTC : <strong className="font-price">{formatPrice(totalTTC)}</strong>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm">
                  Fermer
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintDialog(true)}
                  className="flex-1 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Printer size={15} />
                  Imprimer
                </button>
              </div>
            </div>
          </div>
        </div>
        {showPrintDialog && (
          <PrintDialog
            title={`Facture ${factureNumero}`}
            subtitle={clientNom}
            getPrintHtml={() => printRef.current?.innerHTML ?? ''}
            preview={printPreview}
            pageSize="A4"
            settingsKey="impression_printer_a4"
            onClose={() => setShowPrintDialog(false)}
          />
        )}
      </>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130]">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-accent-500" />
            <h2 className="font-bold text-base">Générer Facture Client</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-muted rounded-xl p-4">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <span className="badge-F">F</span>
              Lignes facturables uniquement
            </div>
            {lignesF.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-2">Aucun produit F dans le panier</p>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {lignesF.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-text-secondary">{item.designation} × {item.quantite}</span>
                    <span className="font-price font-semibold">{formatPrice(item.total_ligne)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between font-bold text-sm border-t border-border pt-2 mt-2">
              <span>Total TTC</span>
              <span className="font-price">{formatPrice(totalTTC)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Nom client <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={clientNom}
                onChange={e => setClientNom(e.target.value)}
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:border-accent-500 outline-none"
                placeholder="Nom ou raison sociale"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Téléphone</label>
                <input
                  type="text"
                  value={clientTel}
                  onChange={e => setClientTel(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:border-accent-500 outline-none"
                  placeholder="2x xxx xxx"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Matricule fiscal</label>
                <input
                  type="text"
                  value={clientMatricule}
                  onChange={e => setClientMatricule(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:border-accent-500 outline-none"
                  placeholder="MF-XXXXX/A"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Adresse</label>
              <input
                type="text"
                value={clientAdresse}
                onChange={e => setClientAdresse(e.target.value)}
                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:border-accent-500 outline-none"
                placeholder="Adresse complète"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !clientNom.trim() || lignesF.length === 0}
            className="flex-1 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <FileText size={15} />
            {loading ? 'Génération...' : 'Générer la Facture'}
          </button>
        </div>
      </div>
    </div>
  )
}
