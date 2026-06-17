import { usePrintThermal } from '../../lib/usePrint'
import { formatPrice } from '../../lib/utils'
import { Printer, X } from 'lucide-react'

interface Props {
  vente: Vente
  items: CartItem[]
  onClose: () => void
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte',
  CHEQUE: 'Chèque',
  MIXTE: 'Mixte',
}

export default function TicketModal({ vente, items, onClose }: Props) {
  const { printRef, handlePrint } = usePrintThermal(`Ticket-${vente.numero}`)

  const date = new Date(vente.created_at)
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Printer size={15} />
            Ticket de caisse
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* Ticket preview */}
        <div className="p-4">
          <div
            ref={printRef}
            className="bg-white font-mono text-xs leading-relaxed mx-auto"
            style={{ maxWidth: '280px', padding: '12px' }}
          >
            {/* Header */}
            <div className="text-center mb-3">
              <div className="font-bold text-base tracking-widest">SMLPOS</div>
              <div className="text-[10px] text-gray-500">Système de Point de Vente</div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="text-[10px]">{dateStr} — {timeStr}</div>
              <div className="text-[10px]">Ticket N° {vente.numero}</div>
              {vente.operateur_nom && (
                <div className="text-[10px]">Caissier: {vente.operateur_nom}</div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Items */}
            <div className="space-y-1 mb-3">
              {items.map((item, i) => {
                const prixFinal = item.prix_unitaire * (1 - item.remise_pct / 100)
                return (
                  <div key={i}>
                    <div className="flex justify-between">
                      <span className="flex-1 truncate pr-2">{item.designation}</span>
                      <span className="whitespace-nowrap">{formatPrice(item.total_ligne)}</span>
                    </div>
                    <div className="text-gray-500 pl-2">
                      {item.quantite} × {formatPrice(prixFinal)}
                      {item.remise_pct > 0 && ` (-${item.remise_pct}%)`}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Totals */}
            <div className="space-y-0.5">
              {vente.total_remises > 0 && (
                <>
                  <div className="flex justify-between">
                    <span>Sous-total</span>
                    <span>{formatPrice(vente.sous_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Remises</span>
                    <span>-{formatPrice(vente.total_remises)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-sm border-t border-gray-200 pt-1 mt-1">
                <span>TOTAL TTC</span>
                <span>{formatPrice(vente.total_ttc)}</span>
              </div>
              <div className="flex justify-between">
                <span>Mode paiement</span>
                <span>{MODE_LABELS[vente.mode_paiement] || vente.mode_paiement}</span>
              </div>
              {vente.mode_paiement === 'ESPECES' && vente.montant_recu != null && (
                <>
                  <div className="flex justify-between">
                    <span>Reçu</span>
                    <span>{formatPrice(vente.montant_recu)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Monnaie</span>
                    <span>{formatPrice(vente.monnaie_rendue ?? 0)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-3" />

            {/* Footer */}
            <div className="text-center text-[10px] text-gray-500">
              <div>Merci pour votre confiance</div>
              <div>Bonne journée !</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            Ignorer
          </button>
          <button
            onClick={() => handlePrint()}
            className="flex-1 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <Printer size={15} />
            Imprimer le Ticket
          </button>
        </div>
      </div>
    </div>
  )
}
