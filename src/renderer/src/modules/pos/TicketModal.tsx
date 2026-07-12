import { Printer, X } from 'lucide-react'
import { printFullHtmlDocument } from '../../lib/nativePrint'
import { buildReceiptTicketHtml } from '../../lib/ticketHtml'
import type { CartItem, Vente } from '../../lib/types'

interface Props {
  vente: Vente
  items: CartItem[]
  onClose: () => void
}

export default function TicketModal({ vente, items, onClose }: Props) {
  const ticketHtml = buildReceiptTicketHtml(vente, items)

  const handlePrint = async () => {
    await printFullHtmlDocument(ticketHtml, {
      pageSize: '58mm',
      settingsKey: 'impression_printer_ticket',
      printKind: 'ticket',
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] animate-slide-in">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Printer size={15} />
            Receipt ticket
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="mx-auto bg-gray-50 border border-border/70 rounded-xl p-3" style={{ width: 320 }}>
            <iframe
              title="Ticket preview"
              srcDoc={ticketHtml}
              className="bg-white border border-gray-200 rounded-lg"
              style={{ width: 280, height: 430, display: 'block' }}
            />
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 bg-muted hover:bg-border text-text-primary font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            Skip
          </button>
          <button
            onClick={() => void handlePrint()}
            className="flex-1 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            <Printer size={15} />
            Print ticket
          </button>
        </div>
      </div>
    </div>
  )
}
