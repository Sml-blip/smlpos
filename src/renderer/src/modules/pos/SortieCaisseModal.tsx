import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { formatPrice, generateId } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import { X, ArrowDownCircle, BookmarkCheck, ReceiptText, UserRound, PenLine } from 'lucide-react'

const api = window.api

type ExitKind = 'LIBRE' | 'FOURNISSEUR' | 'PERSONNEL'
interface SupplierInvoice { id: string; numero_facture: string; fournisseur_id: string; fournisseur_nom?: string; montant_ttc: number; montant_paye: number; statut_paiement: string }
interface StaffMember { id: string; nom: string; prenom?: string; credit_solde: number }

export default function SortieCaisseModal({ onClose }: { onClose: () => void }) {
  const { currentShift } = useAppStore()
  const [kind, setKind] = useState<ExitKind>('LIBRE')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [caisseSource, setCaisseSource] = useState<'EXTERNE' | 'INTERNE'>('EXTERNE')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [paymentType, setPaymentType] = useState<'INSTANT' | 'TRANCHE'>('INSTANT')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      loadData('Chargement suggestions', () => api.sortiesRecentNotes(), { silent: true }),
      loadData('Chargement factures fournisseur', () => api.facturesFournisseursList({}), { silent: true }),
      loadData('Chargement personnel', () => api.personnelsList(), { silent: true }),
    ]).then(([notes, supplierInvoices, staffRows]) => {
      if (notes) setSuggestions(notes as string[])
      if (supplierInvoices) setInvoices((supplierInvoices as SupplierInvoice[]).filter(invoice => invoice.statut_paiement !== 'PAYE' && Number(invoice.montant_ttc) > Number(invoice.montant_paye)))
      if (staffRows) setStaff(staffRows as StaffMember[])
    })
  }, [])

  const selectedInvoice = invoices.find(invoice => invoice.id === invoiceId)
  const remaining = selectedInvoice ? Math.max(0, Number(selectedInvoice.montant_ttc) - Number(selectedInvoice.montant_paye)) : 0
  const amount = parseFloat(montant.replace(',', '.')) || 0
  const filteredSuggestions = note.length < 2 ? suggestions : suggestions.filter(s => s.toLowerCase().includes(note.toLowerCase()))

  const changeKind = (next: ExitKind) => {
    setKind(next); setMontant(''); setNote(''); setInvoiceId(''); setStaffId(''); setPaymentType('INSTANT')
  }
  const chooseInvoice = (id: string) => {
    setInvoiceId(id)
    const invoice = invoices.find(item => item.id === id)
    const due = invoice ? Math.max(0, Number(invoice.montant_ttc) - Number(invoice.montant_paye)) : 0
    if (paymentType === 'INSTANT' && due > 0) setMontant(due.toFixed(3))
  }

  const handleConfirm = async () => {
    if (amount <= 0 || (caisseSource === 'EXTERNE' && !currentShift?.id)) return
    await runAction('Sortie de caisse', async () => {
      const base = { caisse_source: caisseSource, shift_id: currentShift?.id ?? null, operateur: currentShift?.operateur_nom ?? 'superadmin', created_at: new Date().toISOString() }
      if (kind === 'FOURNISSEUR') {
        if (!selectedInvoice) throw new Error('Sélectionnez une facture fournisseur')
        await api.paiementsFournisseursCreate({ id: generateId(), facture_id: selectedInvoice.id, fournisseur_id: selectedInvoice.fournisseur_id, montant: amount, mode_paiement: 'ESPECES', date_paiement: new Date().toLocaleDateString('en-CA'), notes: note.trim() || null, paiement_type: paymentType, ...base })
        window.dispatchEvent(new CustomEvent('smlpos:supplier-payments-changed'))
      } else if (kind === 'PERSONNEL') {
        if (!staffId) throw new Error('Sélectionnez un membre du personnel')
        await api.mouvementsPersonnelsCreate({ id: generateId(), personnel_id: staffId, type: 'CREDIT_PERSONNEL', montant: amount, nature_credit: 'ARGENT', note: note.trim() || 'Crédit argent depuis sortie de caisse', ...base })
      } else {
        if (!note.trim()) throw new Error('Le motif est obligatoire')
        await api.sortiesCreate({ id: generateId(), montant: amount, note: note.trim(), ...base })
      }
      onClose()
    }, { setLoading, successMessage: kind === 'FOURNISSEUR' ? 'Paiement fournisseur et sortie liés' : kind === 'PERSONNEL' ? 'Crédit personnel et sortie liés' : 'Sortie de caisse enregistrée' })
  }

  const valid = amount > 0 && (caisseSource !== 'EXTERNE' || !!currentShift?.id) && (kind === 'LIBRE' ? !!note.trim() : kind === 'FOURNISSEUR' ? !!selectedInvoice && amount <= remaining + 0.0001 : !!staffId)

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-in">
    <div className="flex items-center justify-between border-b border-border px-6 py-4"><h2 className="flex items-center gap-2 font-bold"><ArrowDownCircle size={16}/> Sortie de caisse liée</h2><button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18}/></button></div>
    <div className="max-h-[calc(100vh-10rem)] space-y-4 overflow-y-auto p-6">
      <div className="grid grid-cols-3 gap-2">{([['LIBRE','Libre',PenLine],['FOURNISSEUR','Fournisseur',ReceiptText],['PERSONNEL','Crédit personnel',UserRound]] as const).map(([id,label,Icon]) => <button key={id} onClick={() => changeKind(id)} className={`rounded-xl border-2 p-3 text-xs font-bold ${kind === id ? 'border-accent-500 bg-accent-50' : 'border-border hover:bg-muted'}`}><Icon size={16} className="mx-auto mb-1"/>{label}</button>)}</div>
      <div><label className="mb-1.5 block text-xs font-semibold text-text-secondary">Caisse débitée *</label><div className="grid grid-cols-2 gap-2">{(['EXTERNE','INTERNE'] as const).map(source => <button key={source} type="button" onClick={() => setCaisseSource(source)} className={`rounded-xl border-2 px-3 py-2.5 text-xs font-bold ${caisseSource === source ? 'border-accent-500 bg-accent-50' : 'border-border bg-white hover:bg-muted'}`}>Caisse {source === 'EXTERNE' ? 'externe (shift)' : 'interne'}</button>)}</div></div>
      {kind === 'FOURNISSEUR' && <><div><label className="mb-1.5 block text-xs font-semibold text-text-secondary">Facture fournisseur *</label><select value={invoiceId} onChange={e => chooseInvoice(e.target.value)} className="w-full rounded-xl border border-border px-3 py-3 text-sm"><option value="">Choisir une facture impayée…</option>{invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.fournisseur_nom ?? 'Fournisseur'} · {invoice.numero_facture} · reste {formatPrice(Number(invoice.montant_ttc)-Number(invoice.montant_paye))}</option>)}</select></div><div className="grid grid-cols-2 gap-2">{(['INSTANT','TRANCHE'] as const).map(type => <button key={type} onClick={() => { setPaymentType(type); if (type === 'INSTANT' && remaining > 0) setMontant(remaining.toFixed(3)) }} className={`rounded-xl border px-3 py-2 text-xs font-bold ${paymentType === type ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-border'}`}>{type === 'INSTANT' ? 'Paiement total' : 'Paiement par tranche'}</button>)}</div></>}
      {kind === 'PERSONNEL' && <div><label className="mb-1.5 block text-xs font-semibold text-text-secondary">Personnel *</label><select value={staffId} onChange={e => setStaffId(e.target.value)} className="w-full rounded-xl border border-border px-3 py-3 text-sm"><option value="">Choisir le personnel…</option>{staff.map(person => <option key={person.id} value={person.id}>{person.nom} {person.prenom ?? ''} · crédit actuel {formatPrice(person.credit_solde)}</option>)}</select></div>}
      <div><label className="mb-1.5 block text-xs font-semibold text-text-secondary">Montant (DT) *</label><div className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 focus-within:border-accent-500"><input type="text" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value.replace(/[^0-9.,]/g,'').replace(',','.'))} readOnly={kind === 'FOURNISSEUR' && paymentType === 'INSTANT'} className="flex-1 bg-transparent font-price text-lg font-semibold outline-none" placeholder="0.000" autoFocus/><span className="font-medium text-text-secondary">DT</span></div>{kind === 'FOURNISSEUR' && selectedInvoice && <p className="mt-1 text-[10px] text-text-muted">Reste à payer : {formatPrice(remaining)}</p>}</div>
      <div><label className="mb-1.5 block text-xs font-semibold text-text-secondary">{kind === 'LIBRE' ? 'Motif / Note *' : 'Note (optionnelle)'}</label><input value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-border px-4 py-3 text-sm" placeholder={kind === 'LIBRE' ? 'Décrire la raison…' : 'Détail complémentaire…'}/></div>
      {kind === 'LIBRE' && filteredSuggestions.length > 0 && <div><p className="mb-2 flex items-center gap-1 text-xs font-semibold text-text-secondary"><BookmarkCheck size={11}/> Suggestions</p><div className="flex flex-wrap gap-2">{filteredSuggestions.slice(0,5).map((suggestion,index) => <button key={index} onClick={() => setNote(suggestion)} className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium hover:border-accent-300 hover:bg-accent-50">{suggestion}</button>)}</div></div>}
      {caisseSource === 'EXTERNE' && !currentShift?.id && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Ouvrez une caisse externe avant cette opération.</p>}
    </div>
    <div className="flex gap-3 border-t border-border px-6 py-4"><button type="button" onClick={onClose} className="flex-1 rounded-xl bg-muted py-2.5 font-semibold hover:bg-border">Annuler</button><button type="button" onClick={handleConfirm} disabled={!valid || loading} className="flex-1 rounded-xl bg-accent-500 py-2.5 font-bold text-text-primary hover:bg-accent-600 disabled:bg-gray-200 disabled:text-gray-400">{loading ? 'Confirmation…' : 'Confirmer et lier'}</button></div>
  </div></div>
}
