import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Document, LigneDocument } from '../../lib/types'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import PrintDialog from '../../components/PrintDialog'

const api = window.api

interface Props {
  doc: Document
  onClose: () => void
}

export default function DocumentPrintModal({ doc, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const [lignes, setLignes] = useState<LigneDocument[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const settingsPromise = (doc.layout_snapshot
      ? Promise.resolve(JSON.parse(doc.layout_snapshot) as Record<string, string>)
      : api.settingsGetAll() as Promise<Record<string, string>>
    )
    Promise.all([
      api.documentsGetLignes(doc.id) as Promise<LigneDocument[]>,
      settingsPromise,
    ]).then(([l, s]) => {
      setLignes(l || [])
      setSettings(s || {})
    }).finally(() => setLoading(false))
  }, [doc.id, doc.layout_snapshot])

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140]">
        <RefreshCw size={24} className="animate-spin text-white" />
      </div>
    )
  }

  return (
    <PrintDialog
      title={`Impression — ${doc.numero}`}
      subtitle={`${doc.client_nom || 'Client non spécifié'} · ${new Date(doc.created_at).toLocaleDateString('fr-FR')}`}
      getPrintHtml={() => printRef.current?.innerHTML ?? ''}
      preview={
        <div ref={printRef}>
          <InvoicePrintTemplate doc={doc} lignes={lignes} settings={settings} />
        </div>
      }
      pageSize="A4"
      settingsKey="impression_printer_a4"
      onClose={onClose}
    />
  )
}
