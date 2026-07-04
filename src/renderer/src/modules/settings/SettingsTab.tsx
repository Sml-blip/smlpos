import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { cn } from '../../lib/utils'
import {
  Settings, FileText, ShieldCheck, Printer, Save, RefreshCw,
  Check, Info, Eye, EyeOff, Layout, Upload, X,
  HardDrive, FolderOpen, CloudUpload, Database, RotateCcw,
  Copy, CheckCircle, AlertTriangle, Clock
} from 'lucide-react'
import InvoiceTemplateEditor from './InvoiceTemplateEditor'
import { printTestPage, printLabelTestPage } from '../../components/PrintDialog'
import LabelBarcodeSettingsForm, { labelConfigPatchToSettings } from '../../components/LabelBarcodeSettingsForm'
import { labelConfigFromSettings, scheduleSaveLabelPrintConfig, mergeLabelConfig } from '../../lib/labelSettings'
import type { LabelPrintConfig } from '../../lib/printManager'
import { invalidateProduitsCache } from '../../lib/produitsCache'
import { loadData, runAction } from '../../lib/apiCall'
import { isSupabaseEnabled } from '../../lib/supabase'
import { getPendingCount, getFailedCount, getBootstrapStatus, processSyncQueue, pullSyncFromRemote, resetFailedItems } from '../../lib/sync'
import { showToast } from '../../lib/toast'

const api = window.api

type TabId = 'facture' | 'pos' | 'securite' | 'impression' | 'sauvegarde'

const SECTIONS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'facture',     label: 'Factures',         icon: <FileText size={14} /> },
  { id: 'pos',         label: 'Point de vente',   icon: <Settings size={14} /> },
  { id: 'impression',  label: 'Impression',       icon: <Printer size={14} /> },
  { id: 'securite',    label: 'Sécurité',         icon: <ShieldCheck size={14} /> },
  { id: 'sauvegarde',  label: 'Sauvegarde',       icon: <HardDrive size={14} /> },
]

// Keys must match app_settings table in db.ts
const DEFAULTS: Record<string, string> = {
  // Entreprise
  company_name:          'SML Store',
  company_subtitle:      '',
  company_address:       'Tunis, Tunisie',
  company_phone:         '',
  company_email:         '',
  company_matricule:     '',
  company_rib:           '',
  company_logo:          '',
  // Factures
  facture_layout:        'professionnel',
  invoice_prefix_facture:'FAC',
  invoice_prefix_vente:  'VTE',
  invoice_footer:        'Merci pour votre confiance !',
  invoice_show_tva:      'true',
  invoice_timbre_fiscal: 'true',
  tva_defaut_pct:        '19',
  // POS / Caisse
  fond_de_caisse_defaut: '100',
  frais_retour_colis:    '4',
  credit_max_client:     '500',
  marge_defaut_pct:      '30',
  pos_show_calculator:   'true',
  pos_confirm_sortie:    'true',
  // Impression
  impression_largeur:    '80',
  impression_copies:     '1',
  impression_auto_print: 'false',
  impression_printer_a4: '',
  impression_printer_ticket: '',
  impression_printer_label: '',
  impression_label_width: '40.0',
  impression_label_height: '19.9',
  impression_label_strip_left: '1',
  impression_label_strip_right: '3',
  impression_label_strip_top: '0.35',
  impression_label_strip_bottom: '0.35',
  impression_label_rotation: '0',
  impression_label_bar_height: '5.8',
  impression_label_bar_margin: '3.5',
  impression_label_module_max: '0.38',
  impression_label_show_name: 'true',
  impression_label_show_price: 'true',
  impression_label_show_barcode_text: 'true',
  impression_label_name_font: '5.5',
  impression_label_price_font: '7.5',
  impression_label_name_lines: '2',
  impression_label_align: 'auto',
  impression_label_dpi: '300',
  impression_label_copies: '1',
  // Sécurité
  caisse_interne_pin:    'sml2023',
  securite_require_shift:'true',
  lock_screen_minutes:   '30',
  demo_mode:             'false',
  pin_amira:             'amira123',
  pin_hamdi:             'hamdi123',
  pin_hamma:             'hamma123',
  // Invoice template (used by InvoicePrintTemplate)
  invoice_template_json:  '{}',
  invoice_primary_color:  '#F59E0B',
  // Backup
  backup_folder_path:     '',
  r2_enabled:             'true',
  r2_endpoint:            'https://f41f0491f27adcea5c38afd25e244765.r2.cloudflarestorage.com',
  r2_bucket:              'smlpos',
  r2_access_key_id:       '053d5f9c1dc031fed95ded144c57eba3',
  r2_secret_access_key:   'c2f3cc80323c8e51d69a895c7a779620db84cf97b4414fe43a21630259c0d641',
  // v1.9
  facture_vente_sequence_2026: '0',
  boutique_rib:           '',
  boutique_banque:        '',
}

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState<TabId>('facture')
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [appVer, setAppVer] = useState('1.9.1')

  const load = useCallback(async () => {
    const stored = await loadData('Chargement paramètres', async () => {
      const s = await api.settingsGetAll() as Record<string, string>
      const ver = await api.appVersion().catch(() => '1.9.1') as string
      return { s, ver }
    }, { setLoading })
    if (stored) {
      setValues({ ...DEFAULTS, ...stored.s })
      if (stored.ver) setAppVer(stored.ver)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key: string, val: string) => setValues(prev => ({ ...prev, [key]: val }))
  const toggle = (key: string) => set(key, values[key] === 'true' ? 'false' : 'true')

  const handleSave = async () => {
    const ok = await runAction('Enregistrement paramètres', async () => {
      await api.settingsSetMany(values)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }, { setLoading, successMessage: 'Paramètres sauvegardés' })
    if (!ok) setSaved(false)
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface">
      {/* Sidebar */}
      <div className="w-52 bg-white border-r border-border flex-shrink-0 py-3">
        <div className="px-4 py-2 mb-1">
          <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Paramètres</p>
        </div>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={cn('w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors',
              activeSection === s.id
                ? 'bg-accent-50 text-text-primary border-r-2 border-accent-500'
                : 'text-text-secondary hover:bg-muted hover:text-text-primary')}>
            <span className={activeSection === s.id ? 'text-text-primary' : 'text-text-muted'}>{s.icon}</span>
            {s.label}
          </button>
        ))}
        <div className="px-4 py-2 mt-3 mb-1">
          <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Modèles</p>
        </div>
        <button onClick={() => setShowTemplateEditor(true)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-text-secondary hover:bg-muted hover:text-text-primary">
          <span className="text-text-muted"><Layout size={14} /></span>
          Modèle Facture A4
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-border flex-shrink-0">
          <h2 className="font-bold text-sm">
            {SECTIONS.find(s => s.id === activeSection)?.label}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={handleSave} disabled={loading}
              className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all',
                saved ? 'bg-green-500 text-white' : 'bg-accent-500 hover:bg-accent-600 text-text-primary')}>
              {saved ? <><Check size={14} /> Sauvegardé</> : <><Save size={14} /> Sauvegarder</>}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeSection === 'facture'     && <FactureSection values={values} set={set} toggle={toggle} />}
          {activeSection === 'pos'         && <POSSection values={values} set={set} toggle={toggle} />}
          {activeSection === 'impression'  && <ImpressionSection values={values} set={set} toggle={toggle} />}
          {activeSection === 'securite'    && <SecuriteSection values={values} set={set} toggle={toggle} appVer={appVer} />}
          {activeSection === 'sauvegarde'  && <SauvegardeSection values={values} set={set} />}
        </div>
      </div>
      {showTemplateEditor && (
        <InvoiceTemplateEditor onClose={() => setShowTemplateEditor(false)} />
      )}
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-secondary mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
    </div>
  )
}
function TextInput({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  const isNum = type === 'number'
  return (
    <input
      type={isNum ? 'text' : type}
      inputMode={isNum ? 'decimal' : undefined}
      value={value}
      onChange={e => {
        const val = isNum ? e.target.value.replace(/[^0-9.,]/g, '') : e.target.value
        onChange(val)
      }}
      placeholder={placeholder}
      className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white"
    />
  )
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div className={cn('w-10 h-5 rounded-full transition-colors relative flex-shrink-0', checked ? 'bg-accent-500' : 'bg-gray-300')}
        onClick={onChange}>
        <div className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </div>
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="font-bold text-sm text-text-primary pb-2 border-b border-border">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-border shadow-card p-5 space-y-4">{children}</div>
}

// ── Sections ──────────────────────────────────────────────────────────────────

function FactureSection({ values, set, toggle }: { values: Record<string, string>; set: (k: string, v: string) => void; toggle: (k: string) => void }) {
  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <Section title="Mise en page">
          <Field label="Layout de facture">
            <div className="grid grid-cols-2 gap-3 mt-1">
              {[
                { id: 'basique', label: 'Basique', desc: 'Simple et épuré' },
                { id: 'professionnel', label: 'Professionnel', desc: 'En-tête + logo + pied de page' },
              ].map(l => (
                <button key={l.id} onClick={() => set('facture_layout', l.id)}
                  className={cn('border-2 rounded-xl p-3 text-left transition-all',
                    values['facture_layout'] === l.id ? 'border-accent-500 bg-accent-50' : 'border-border hover:border-gray-300')}>
                  <div className="font-semibold text-sm">{l.label}</div>
                  <div className="text-xs text-text-muted mt-0.5">{l.desc}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Pied de page (factures & tickets)">
            <TextInput value={values['invoice_footer']} onChange={v => set('invoice_footer', v)} placeholder="Merci pour votre confiance." />
          </Field>
        </Section>
      </Card>
      <Card>
        <Section title="Numérotation">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Préfixe factures clients" hint="Ex: FAC → FAC-20260501-001">
              <TextInput value={values['invoice_prefix_facture']} onChange={v => set('invoice_prefix_facture', v)} />
            </Field>
            <Field label="Préfixe ventes" hint="Ex: VTE → VTE-20260501-0001">
              <TextInput value={values['invoice_prefix_vente']} onChange={v => set('invoice_prefix_vente', v)} />
            </Field>
          </div>
        </Section>
      </Card>
      <Card>
        <Section title="TVA">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Taux TVA par défaut (%)" hint="Appliqué aux articles Facturés (F)">
              <TextInput type="number" value={values['tva_defaut_pct']} onChange={v => set('tva_defaut_pct', v)} />
            </Field>
          </div>
          <Toggle checked={values['invoice_show_tva'] === 'true'} onChange={() => toggle('invoice_show_tva')} label="Afficher la décomposition TVA sur les factures" />
          <Toggle checked={values['invoice_timbre_fiscal'] === 'true'} onChange={() => toggle('invoice_timbre_fiscal')} label="Ajouter timbre fiscal (1.000 DT) sur les factures" />
        </Section>
      </Card>
      <Card>
        <Section title="Coordonnées Bancaires (affiché sur les factures)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="RIB bancaire" hint="Affiché en bas de chaque facture">
              <TextInput value={values['boutique_rib']} onChange={v => set('boutique_rib', v)} placeholder="XX XXX XXXXXXX XXXXXXXXXXXX XX" />
            </Field>
            <Field label="Nom de la banque" hint="Ex: BNA, BIAT, Attijari...">
              <TextInput value={values['boutique_banque']} onChange={v => set('boutique_banque', v)} placeholder="Banque Nationale Agricole" />
            </Field>
          </div>
          {values['boutique_rib'] && (
            <div className="mt-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-lg text-xs text-text-secondary">
              Aperçu : <strong>{values['boutique_banque'] ? `${values['boutique_banque']} — ` : ''}RIB : {values['boutique_rib']}</strong>
            </div>
          )}
        </Section>
      </Card>
    </div>
  )
}

function POSSection({ values, set, toggle }: { values: Record<string, string>; set: (k: string, v: string) => void; toggle: (k: string) => void }) {
  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <Section title="Caisse">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fond de caisse par défaut (DT)" hint="Montant pré-rempli à l'ouverture de shift">
              <TextInput type="number" value={values['fond_de_caisse_defaut']} onChange={v => set('fond_de_caisse_defaut', v)} />
            </Field>
            <Field label="Frais retour vente en ligne (DT)" hint="Montant déduit lors d'un retour commande">
              <TextInput type="number" value={values['frais_retour_colis']} onChange={v => set('frais_retour_colis', v)} />
            </Field>
          </div>
        </Section>
      </Card>
      <Card>
        <Section title="Crédits clients & Marges">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Crédit max par client (DT)" hint="Plafond de crédit accordé par défaut">
              <TextInput type="number" value={values['credit_max_client']} onChange={v => set('credit_max_client', v)} />
            </Field>
            <Field label="Marge bénéficiaire par défaut (%)" hint="Utilisée pour suggérer le prix de vente">
              <TextInput type="number" value={values['marge_defaut_pct']} onChange={v => set('marge_defaut_pct', v)} />
            </Field>
          </div>
        </Section>
      </Card>
      <Card>
        <Section title="Interface">
          <div className="space-y-3">
            <Toggle checked={values['pos_show_calculator'] === 'true'} onChange={() => toggle('pos_show_calculator')} label="Afficher la calculette dans le POS" />
            <Toggle checked={values['pos_confirm_sortie'] === 'true'} onChange={() => toggle('pos_confirm_sortie')} label="Demander confirmation avant sortie de caisse" />
          </div>
        </Section>
      </Card>
    </div>
  )
}

function ImpressionSection({ values, set, toggle }: { values: Record<string, string>; set: (k: string, v: string) => void; toggle: (k: string) => void }) {
  const [printers, setPrinters] = useState<{ name: string; isDefault?: boolean }[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [labelSaveState, setLabelSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const labelHydratedRef = useRef(false)

  const labelCfg = useMemo(() => labelConfigFromSettings(values), [values])

  const patchLabelCfg = useCallback((patch: Partial<LabelPrintConfig>) => {
    const next = mergeLabelConfig({ ...labelCfg, ...patch })
    const settingsPatch = labelConfigPatchToSettings(patch, labelCfg)
    for (const [key, val] of Object.entries(settingsPatch)) {
      set(key, val)
    }
  }, [labelCfg, set])

  useEffect(() => {
    if (!labelHydratedRef.current) {
      labelHydratedRef.current = true
      return
    }
    setLabelSaveState('saving')
    scheduleSaveLabelPrintConfig(labelCfg, (ok) => {
      setLabelSaveState(ok ? 'saved' : 'idle')
      if (ok) window.setTimeout(() => setLabelSaveState('idle'), 2000)
    })
  }, [labelCfg])

  const refreshPrinters = useCallback(async () => {
    setLoadingPrinters(true)
    try {
      const list = (await api.getPrinters?.()) as { name: string; isDefault?: boolean }[] | undefined
      setPrinters(list ?? [])
    } finally {
      setLoadingPrinters(false)
    }
  }, [])

  useEffect(() => { refreshPrinters() }, [refreshPrinters])

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <Section title="Imprimantes">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 mb-3">
            Imprimantes séparées : documents A4 (facture, devis, BL), tickets caisse, étiquettes code-barres.
          </div>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Imprimante factures / devis / BL (A4)">
              <select value={values['impression_printer_a4'] ?? ''} onChange={e => set('impression_printer_a4', e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
                <option value="">— Choisir une imprimante —</option>
                {printers.map(p => (
                  <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (défaut)' : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Imprimante tickets (thermique)">
              <select value={values['impression_printer_ticket'] ?? ''} onChange={e => set('impression_printer_ticket', e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
                <option value="">— Choisir une imprimante —</option>
                {printers.map(p => (
                  <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (défaut)' : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Imprimante étiquettes (ex. Gainscha GS-2408D)">
              <select value={values['impression_printer_label'] ?? ''} onChange={e => set('impression_printer_label', e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
                <option value="">— Choisir une imprimante —</option>
                {printers.map(p => (
                  <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (défaut)' : ''}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={refreshPrinters} disabled={loadingPrinters}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <RefreshCw size={12} className={loadingPrinters ? 'animate-spin' : ''} /> Actualiser liste
            </button>
            <button type="button" onClick={() => printTestPage(values['impression_printer_a4'] ?? '', 'A4')}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 rounded-lg text-xs font-bold">
              <Printer size={12} /> Test A4
            </button>
            <button type="button" onClick={() => printTestPage(values['impression_printer_ticket'] ?? '', '58mm')}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <Printer size={12} /> Test ticket
            </button>
            <button type="button" onClick={() => printLabelTestPage()}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <Printer size={12} /> Test étiquette
            </button>
          </div>
        </Section>
      </Card>
      <Card>
        <Section title="Étiquettes code-barres">
          <LabelBarcodeSettingsForm
            config={labelCfg}
            onChange={patchLabelCfg}
            saveState={labelSaveState}
          />
        </Section>
      </Card>
      <Card>
        <Section title="Ticket de caisse">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Largeur ticket (mm)" hint="80mm standard ou 58mm pour petites imprimantes">
              <select value={values['impression_largeur']} onChange={e => set('impression_largeur', e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
              </select>
            </Field>
            <Field label="Nombre de copies">
              <select value={values['impression_copies']} onChange={e => set('impression_copies', e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
                <option value="1">1 copie</option>
                <option value="2">2 copies</option>
                <option value="3">3 copies</option>
              </select>
            </Field>
          </div>
          <Toggle checked={values['impression_auto_print'] === 'true'} onChange={() => toggle('impression_auto_print')} label="Imprimer automatiquement après chaque vente" />
        </Section>
      </Card>
    </div>
  )
}

function OperateurPinField({ label, pinKey, values, set }: { label: string; pinKey: string; values: Record<string, string>; set: (k: string, v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <Field label={label}>
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={values[pinKey] ?? ''} onChange={e => set(pinKey, e.target.value)}
          className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 pr-10 font-mono tracking-widest" maxLength={30} />
        <button type="button" onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </Field>
  )
}

function SecuriteSection({ values, set, toggle, appVer }: { values: Record<string, string>; set: (k: string, v: string) => void; toggle: (k: string) => void; appVer: string }) {
  return (
    <div className="max-w-2xl space-y-5">
      {/* Per-operator PINs */}
      <Card>
        <Section title="PINs Opérateurs">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-amber-800">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>Chaque opérateur a son propre PIN pour déverrouiller la session après inactivité. N'oubliez pas de sauvegarder.</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <OperateurPinField label="PIN Amira" pinKey="pin_amira" values={values} set={set} />
            <OperateurPinField label="PIN Hamdi (admin)" pinKey="pin_hamdi" values={values} set={set} />
            <OperateurPinField label="PIN Hamma" pinKey="pin_hamma" values={values} set={set} />
          </div>
        </Section>
      </Card>

      {/* Lock screen */}
      <Card>
        <Section title="Verrouillage automatique">
          <Field label="Verrouiller après (minutes)" hint="0 = désactivé. Après inactivité, l'opérateur doit saisir son PIN.">
            <select value={values['lock_screen_minutes'] ?? '30'} onChange={e => set('lock_screen_minutes', e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white">
              <option value="0">Désactivé</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 heure</option>
            </select>
          </Field>
        </Section>
      </Card>

      {/* Caisse interne PIN */}
      <Card>
        <Section title="PIN Caisse Interne">
          <Field label="PIN Caisse Interne" hint="Protège l'accès à la trésorerie.">
            <OperateurPinField label="" pinKey="caisse_interne_pin" values={values} set={set} />
          </Field>
        </Section>
      </Card>

      <Card>
        <Section title="Accès et sessions">
          <Toggle checked={values['securite_require_shift'] === 'true'} onChange={() => toggle('securite_require_shift')} label="Exiger l'ouverture d'un shift pour accéder au POS" />
          <Toggle checked={values['demo_mode'] === 'true'} onChange={() => toggle('demo_mode')} label="Mode démo (désactive le verrouillage automatique)" />
        </Section>
      </Card>

      <FactoryResetCard />

      <Card>
        <Section title="À propos">
          <div className="space-y-1 text-sm text-text-secondary">
            <div className="flex justify-between"><span>Version</span><span className="font-semibold text-text-primary">SMLPOS v{appVer}</span></div>
            <div className="flex justify-between"><span>Base de données</span><span className="font-semibold text-text-primary">SQLite (local)</span></div>
            <div className="flex justify-between"><span>Sync cloud</span><span className="font-semibold text-text-primary">Supabase</span></div>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <UpdateCheckButton />
          </div>
        </Section>
      </Card>
    </div>
  )
}

function FactoryResetCard() {
  const [confirm, setConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const [importingCatalog, setImportingCatalog] = useState(false)

  const handleReset = async () => {
    if (confirm !== 'REINITIALISER') return
    const ok = window.confirm(
      'Toutes les données locales seront effacées : ventes, stock, clients, shifts, sauvegardes.\n\nL\'application redémarrera comme à la première installation.\n\nContinuer ?',
    )
    if (!ok) return
    setResetting(true)
    const watchdog = window.setTimeout(() => setResetting(false), 12000)
    try {
      Object.keys(localStorage).filter(k => k.startsWith('smlpos_')).forEach(k => localStorage.removeItem(k))
      invalidateProduitsCache()
      const res = await api.factoryReset?.() as { success?: boolean; error?: string; deferred?: boolean } | undefined
      if (res && res.success === false) {
        showToast('error', res.error ?? 'Échec de la réinitialisation')
        setResetting(false)
      }
      // App relaunches on success — no toast needed
    } catch {
      showToast('error', 'Échec de la réinitialisation')
      setResetting(false)
    } finally {
      window.clearTimeout(watchdog)
    }
  }

  const handleImportDefaultCatalog = async () => {
    const ok = window.confirm('Importer le catalogue par défaut (~1146 produits) dans l\'inventaire ?')
    if (!ok) return
    setImportingCatalog(true)
    try {
      const res = await api.importDefaultCatalog?.() as { success?: boolean; count?: number; error?: string } | undefined
      if (res?.success) {
        invalidateProduitsCache()
        showToast('success', `Catalogue importé (${res.count ?? 0} produits)`)
      } else {
        showToast('error', res?.error ?? 'Échec import catalogue')
      }
    } catch {
      showToast('error', 'Échec import catalogue')
    } finally {
      setImportingCatalog(false)
    }
  }

  return (
    <Card>
      <Section title="Réinitialisation (première utilisation)">
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-red-800 mb-4">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Efface la base SQLite, toutes les ventes, le stock modifié, les clients et les sauvegardes locales.
            Le catalogue produits sera vide (pas de réimport automatique). Action irréversible.
          </span>
        </div>
        <Field label="Tapez REINITIALISER pour confirmer">
          <TextInput value={confirm} onChange={setConfirm} placeholder="REINITIALISER" />
        </Field>
        <button
          type="button"
          disabled={confirm !== 'REINITIALISER' || resetting || !api.factoryReset}
          onClick={handleReset}
          className="mt-3 px-4 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl"
        >
          {resetting ? 'Réinitialisation…' : 'Effacer toutes les données et redémarrer'}
        </button>
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-secondary mb-2">
            Après une réinitialisation, l&apos;inventaire reste vide. Importez le catalogue seulement si vous en avez besoin.
          </p>
          <button
            type="button"
            disabled={importingCatalog || !api.importDefaultCatalog}
            onClick={handleImportDefaultCatalog}
            className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-secondary disabled:opacity-40"
          >
            {importingCatalog ? 'Import…' : 'Importer le catalogue par défaut (~1146 produits)'}
          </button>
        </div>
      </Section>
    </Card>
  )
}

// ── Sauvegarde Section ─────────────────────────────────────────────────────────
const SUPABASE_SQL = `-- SMLPOS v1.9.1 — Supabase PostgreSQL Migration
-- Paste this in: Supabase Dashboard > SQL Editor > New Query > Run

CREATE TABLE IF NOT EXISTS operateurs (id TEXT PRIMARY KEY, nom TEXT NOT NULL, identifiant TEXT UNIQUE NOT NULL, role TEXT DEFAULT 'caissier', actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, nom TEXT UNIQUE NOT NULL, icone TEXT);
CREATE TABLE IF NOT EXISTS fournisseurs (id TEXT PRIMARY KEY, nom TEXT NOT NULL, contact_nom TEXT, telephone TEXT, email TEXT, adresse TEXT, matricule_fiscal TEXT, rib TEXT, solde_du FLOAT DEFAULT 0, notes TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS fournisseur_commerciaux (id TEXT PRIMARY KEY, fournisseur_id TEXT, nom TEXT NOT NULL, telephone TEXT, email TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS produits (id TEXT PRIMARY KEY, code_barre TEXT UNIQUE, reference TEXT UNIQUE NOT NULL, nom TEXT NOT NULL, description TEXT, categorie TEXT DEFAULT 'Général', categorie_id TEXT, type TEXT DEFAULT 'F', prix_achat FLOAT, prix_vente FLOAT NOT NULL DEFAULT 0, tva_taux FLOAT DEFAULT 0, stock_actuel INTEGER DEFAULT 0, stock_minimum INTEGER DEFAULT 5, fournisseur TEXT, fournisseur_id TEXT, actif INTEGER DEFAULT 1, has_serial_number INTEGER DEFAULT 0, numero_serie TEXT, tva_achat_pct FLOAT DEFAULT 0, marge_pct FLOAT, coef_av FLOAT, cout_supplementaire FLOAT DEFAULT 0, cout_de_revient FLOAT, prix_vente_ht FLOAT, pvp FLOAT, prix_achat_ttc FLOAT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS serial_numbers (id TEXT PRIMARY KEY, produit_id TEXT NOT NULL, numero_serie TEXT NOT NULL, statut TEXT DEFAULT 'EN_STOCK', vente_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS services_pos (id TEXT PRIMARY KEY, nom TEXT NOT NULL, code_barre TEXT UNIQUE NOT NULL, logo_url TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS transactions_services (id TEXT PRIMARY KEY, shift_id TEXT, service_id TEXT, service_nom TEXT NOT NULL, montant_frais FLOAT NOT NULL, note TEXT, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, operateur_id TEXT, operateur_nom TEXT NOT NULL, fond_de_caisse FLOAT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, total_ventes_especes FLOAT DEFAULT 0, total_services FLOAT DEFAULT 0, total_reparations FLOAT DEFAULT 0, total_credits_recus FLOAT DEFAULT 0, total_sorties FLOAT DEFAULT 0, solde_theorique FLOAT, solde_declare FLOAT, ecart FLOAT, transfere_caisse_interne INTEGER DEFAULT 0, notes_cloture TEXT);
CREATE TABLE IF NOT EXISTS ventes (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, shift_id TEXT, operateur_nom TEXT, client_nom TEXT, client_tel TEXT, client_adresse TEXT, client_matricule TEXT, sous_total FLOAT, total_remises FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL, mode_paiement TEXT, montant_recu FLOAT, monnaie_rendue FLOAT DEFAULT 0, type TEXT DEFAULT 'VENTE', a_facture INTEGER DEFAULT 0, statut TEXT DEFAULT 'ACTIVE', annule_par TEXT, annule_at TEXT, annule_motif TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lignes_vente (id TEXT PRIMARY KEY, vente_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, prix_unitaire FLOAT NOT NULL, remise_pct FLOAT DEFAULT 0, total_ligne FLOAT NOT NULL, type_produit TEXT DEFAULT 'F');
CREATE TABLE IF NOT EXISTS factures_clients (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, shift_id TEXT, vente_id TEXT, type_facture TEXT DEFAULT 'VENTE_INDIVIDUELLE', client_nom TEXT, client_tel TEXT, client_adresse TEXT, client_matricule TEXT, total_ht FLOAT NOT NULL, total_tva FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL, imprimee INTEGER DEFAULT 0, tva_taux_principal FLOAT, exo TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reparations (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, shift_id TEXT, operateur_nom TEXT, client_nom TEXT, client_tel TEXT, type_appareil TEXT, marque TEXT, modele TEXT, description_panne TEXT, main_oeuvre FLOAT DEFAULT 0, acompte FLOAT DEFAULT 0, total_estime FLOAT DEFAULT 0, total_final FLOAT, statut TEXT DEFAULT 'EN_ATTENTE', technicien TEXT, notes_technicien TEXT, benefice FLOAT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS pieces_reparation (id TEXT PRIMARY KEY, reparation_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER DEFAULT 1, prix_unitaire FLOAT DEFAULT 0, type TEXT DEFAULT 'F');
CREATE TABLE IF NOT EXISTS sorties_caisse (id TEXT PRIMARY KEY, shift_id TEXT, montant FLOAT NOT NULL, note TEXT NOT NULL, operateur TEXT, mouvement_interne_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS factures_fournisseurs (id TEXT PRIMARY KEY, numero_facture TEXT NOT NULL, fournisseur_id TEXT, date_facture TEXT NOT NULL, date_echeance TEXT, statut_paiement TEXT DEFAULT 'EN_ATTENTE', montant_ht FLOAT NOT NULL, montant_tva FLOAT DEFAULT 0, montant_ttc FLOAT NOT NULL, montant_paye FLOAT DEFAULT 0, notes TEXT, type TEXT DEFAULT 'FACTURE_ACHAT', statut_reception TEXT DEFAULT 'ARRIVE', exo TEXT, timbre FLOAT DEFAULT 1, ht_7 FLOAT, tva_7 FLOAT, ht_19 FLOAT, tva_19 FLOAT, total_remise FLOAT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lignes_facture_fournisseur (id TEXT PRIMARY KEY, facture_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, ancien_prix_achat FLOAT, nouveau_prix_achat FLOAT NOT NULL, prix_vente_suggere FLOAT, prix_vente_applique FLOAT, tva_taux FLOAT DEFAULT 0);
CREATE TABLE IF NOT EXISTS paiements_fournisseurs (id TEXT PRIMARY KEY, facture_id TEXT, fournisseur_id TEXT, montant FLOAT NOT NULL, mode_paiement TEXT DEFAULT 'ESPECES', reference_cheque TEXT, date_paiement TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, email TEXT, adresse TEXT, matricule_fiscal TEXT, credit_limite FLOAT DEFAULT 500, solde_credit FLOAT DEFAULT 0, organisation_id TEXT, agent TEXT, actif INTEGER DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS credits_clients (id TEXT PRIMARY KEY, client_id TEXT, client_nom TEXT NOT NULL, shift_id TEXT, type TEXT NOT NULL, montant FLOAT NOT NULL, reference TEXT, note TEXT, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, email TEXT, adresse TEXT, matricule_fiscal TEXT, credit_total FLOAT DEFAULT 0, notes TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS personnels (id TEXT PRIMARY KEY, nom TEXT NOT NULL, prenom TEXT, poste TEXT, telephone TEXT, cin TEXT UNIQUE, date_embauche TEXT, salaire_base FLOAT NOT NULL DEFAULT 0, avance_solde FLOAT DEFAULT 0, credit_solde FLOAT DEFAULT 0, actif INTEGER DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mouvements_personnels (id TEXT PRIMARY KEY, personnel_id TEXT, type TEXT NOT NULL, montant FLOAT NOT NULL, mois TEXT, note TEXT, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, type_document TEXT NOT NULL, statut TEXT DEFAULT 'ACTIF', shift_id TEXT, vente_id TEXT, fournisseur_id TEXT, client_id TEXT, client_nom TEXT, client_tel TEXT, client_adresse TEXT, client_matricule TEXT, total_ht FLOAT NOT NULL DEFAULT 0, total_tva FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL DEFAULT 0, statut_paiement TEXT DEFAULT 'PAYE', montant_paye FLOAT DEFAULT 0, date_echeance TEXT, imprimee INTEGER DEFAULT 0, layout_snapshot TEXT, contenu_json TEXT, exo TEXT, timbre FLOAT DEFAULT 1, ht_7 FLOAT, tva_7 FLOAT, ht_19 FLOAT, tva_19 FLOAT, total_remise FLOAT, tva_taux_principal FLOAT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lignes_document (id TEXT PRIMARY KEY, document_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, prix_unitaire FLOAT NOT NULL, remise_pct FLOAT DEFAULT 0, tva_taux FLOAT DEFAULT 0, total_ht FLOAT NOT NULL, total_tva FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL, type_produit TEXT DEFAULT 'F');
CREATE TABLE IF NOT EXISTS ventes_en_ligne (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, shift_id TEXT, operateur_nom TEXT, client_nom TEXT NOT NULL, client_tel TEXT, client_adresse TEXT, produits_json TEXT NOT NULL DEFAULT '[]', montant_ttc FLOAT NOT NULL, montant_net FLOAT, frais_livraison FLOAT DEFAULT 0, frais_retour FLOAT DEFAULT 4, statut TEXT DEFAULT 'EN_ATTENTE', livraison_nom TEXT, montant_recu FLOAT DEFAULT 0, reference_livraison TEXT, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS retours (id TEXT PRIMARY KEY, vente_id TEXT, vente_numero TEXT, shift_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, prix_unitaire FLOAT NOT NULL, motif TEXT, type_retour TEXT NOT NULL, statut TEXT DEFAULT 'EN_ATTENTE', resolution TEXT, montant_rembourse FLOAT DEFAULT 0, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS caisse_interne (id TEXT PRIMARY KEY, date_journal TEXT UNIQUE NOT NULL, solde_ouverture FLOAT NOT NULL DEFAULT 100, total_entrees FLOAT DEFAULT 0, total_sorties FLOAT DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mouvements_caisse_interne (id TEXT PRIMARY KEY, date_journal TEXT NOT NULL, type TEXT NOT NULL, categorie TEXT NOT NULL, montant FLOAT NOT NULL, reference_id TEXT, note TEXT, operateur TEXT DEFAULT 'superadmin', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY, shift_id TEXT, operateur TEXT, action TEXT NOT NULL, details TEXT DEFAULT '{}', montant FLOAT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, record_id TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());

-- Allow all access via anon key (disable RLS or add policies)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE ' || t || ' ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS allow_all ON ' || t;
    EXECUTE 'CREATE POLICY allow_all ON ' || t || ' FOR ALL USING (true) WITH CHECK (true)';
  END LOOP;
END $$;`

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`
}
function fmtTime(ts: number | null): string {
  if (!ts) return 'Jamais'
  return new Date(ts).toLocaleString('fr-TN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function SauvegardeSection({ values, set }: { values: Record<string, string>; set: (k: string, v: string) => void }) {
  const api = window.api
  const [stats, setStats] = useState<{ count: number; lastTime: number | null; totalSize: number; dbSize: number; dbPath: string; backupDir: string } | null>(null)
  const [backups, setBackups] = useState<{ name: string; size: number; time: number; path: string }[]>([])
  const [creating, setCreating] = useState(false)
  const [lastMsg, setLastMsg] = useState('')
  const [copiedSql, setCopiedSql] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<{
    activeCount: number
    candidates: { path: string; productCount: number; size: number; mtime: number; source: string }[]
  } | null>(null)
  const [scanningRecovery, setScanningRecovery] = useState(false)
  const [syncPending, setSyncPending] = useState(0)
  const [syncFailed, setSyncFailed] = useState(0)
  const [bootstrapDone, setBootstrapDone] = useState(false)
  const [bootstrapErrors, setBootstrapErrors] = useState<string | undefined>()
  const [syncing, setSyncing] = useState(false)
  const [r2Status, setR2Status] = useState<{
    configured: boolean
    enabled: boolean
    machineId: string
    bucket: string
    endpoint: string
    lastUploadAt: number | null
    lastError: string | null
    snapshotCount: number
    nextUploadInMs: number | null
  } | null>(null)
  const [r2Snapshots, setR2Snapshots] = useState<{ key: string; size: number; lastModified: number; label: string }[]>([])
  const [r2Loading, setR2Loading] = useState(false)
  const [r2Uploading, setR2Uploading] = useState(false)
  const [r2Testing, setR2Testing] = useState(false)
  const [showR2Secret, setShowR2Secret] = useState(false)
  const [restoringR2, setRestoringR2] = useState<string | null>(null)

  const refreshSync = useCallback(async () => {
    if (!isSupabaseEnabled) return
    const [p, f, b] = await Promise.all([getPendingCount(), getFailedCount(), getBootstrapStatus()])
    setSyncPending(p)
    setSyncFailed(f)
    setBootstrapDone(b.completed)
    setBootstrapErrors(b.errors)
  }, [])

  useEffect(() => { refreshSync(); const t = setInterval(refreshSync, 8000); return () => clearInterval(t) }, [refreshSync])

  const handleForceSyncNow = async () => {
    await runAction('Synchronisation', async () => {
      await pullSyncFromRemote({ full: false })
      await processSyncQueue()
      await refreshSync()
    }, { setLoading: setSyncing, successMessage: 'Synchronisation terminée (envoi + réception)' })
  }

  const loadStats = useCallback(async () => {
    const s = await loadData('Chargement sauvegardes', () => api.backupGetStats(), { silent: true }) as typeof stats | null
    if (s) setStats(s)
    const b = await loadData('Liste sauvegardes', () => api.backupList(), { silent: true }) as typeof backups | null
    if (b) setBackups(b.slice(0, 15))
  }, [api])

  useEffect(() => { loadStats() }, [loadStats])

  const loadR2 = useCallback(async () => {
    if (!api.r2GetStatus) return
    setR2Loading(true)
    const [status, snaps] = await Promise.all([
      api.r2GetStatus().catch(() => null),
      api.r2ListSnapshots?.().catch(() => []),
    ])
    if (status) setR2Status(status)
    if (snaps) setR2Snapshots(snaps.slice(0, 720))
    setR2Loading(false)
  }, [api])

  useEffect(() => { void loadR2() }, [loadR2])

  const saveR2Config = useCallback(async (silent = false) => {
    const action = async () => {
      await api.settingsSetMany({
        r2_enabled: values.r2_enabled,
        r2_endpoint: values.r2_endpoint,
        r2_bucket: values.r2_bucket,
        r2_access_key_id: values.r2_access_key_id,
        r2_secret_access_key: values.r2_secret_access_key,
      })
      await loadR2()
    }
    if (silent) {
      await action()
      return
    }
    await runAction('Configuration cloud', action, { successMessage: 'Configuration cloud enregistrée' })
  }, [api, values.r2_enabled, values.r2_endpoint, values.r2_bucket, values.r2_access_key_id, values.r2_secret_access_key, loadR2])

  const handleSaveR2 = () => saveR2Config(false)

  const handleR2Test = async () => {
    if (!api.r2TestConnection) return
    setR2Testing(true)
    await saveR2Config(true)
    const r = await api.r2TestConnection()
    setR2Testing(false)
    if (r.ok) showToast('success', 'Connexion R2 OK')
    else showToast('error', r.error ?? 'Connexion R2 échouée')
  }

  const handleR2Upload = async () => {
    if (!api.r2UploadNow) return
    setR2Uploading(true)
    await saveR2Config(true)
    const r = await api.r2UploadNow()
    setR2Uploading(false)
    if (r.success && !r.skipped) {
      showToast('success', 'Snapshot cloud envoyé')
      await loadR2()
    } else if (r.skipped) {
      showToast('info', 'Snapshot déjà envoyé cette heure')
    } else {
      showToast('error', r.error ?? 'Envoi cloud échoué')
    }
  }

  const handleR2Restore = async (key: string, label: string) => {
    if (!api.r2Restore) return
    if (!confirm(`Restaurer le snapshot cloud "${label}" ?\n\nL'application va redémarrer.`)) return
    setRestoringR2(key)
    await runAction('Restauration cloud', () => api.r2Restore!(key), { silent: true })
    setRestoringR2(null)
  }

  const scanRecovery = useCallback(async () => {
    if (!api.backupDiscover) return
    setScanningRecovery(true)
    const r = await loadData('Recherche sauvegardes', () => api.backupDiscover!(), { silent: true }) as {
      success?: boolean
      activeCount?: number
      candidates?: { path: string; productCount: number; size: number; mtime: number; source: string }[]
    } | null
    if (r?.success) {
      setRecovery({
        activeCount: r.activeCount ?? 0,
        candidates: r.candidates ?? [],
      })
    }
    setScanningRecovery(false)
  }, [api])

  useEffect(() => { void scanRecovery() }, [scanRecovery])

  const handleCreateBackup = async () => {
    setCreating(true)
    const ok = await runAction('Sauvegarde', async () => {
      const r = await api.backupCreate() as { success: boolean; filename?: string; external?: boolean }
      if (!r.success) throw new Error('Échec de la sauvegarde')
      setLastMsg(`✓ Sauvegardé : ${r.filename}${r.external ? ' + dossier externe' : ''}`)
      await loadStats()
    }, { silent: true })
    if (!ok) setLastMsg('Échec de la sauvegarde')
    setCreating(false)
    setTimeout(() => setLastMsg(''), 5000)
  }

  const handleChooseFolder = async () => {
    const r = await loadData('Sélection dossier', () => api.backupChooseExternalFolder(), { silent: true }) as { canceled?: boolean; path?: string } | null
    if (r && !r.canceled && r.path) {
      set('backup_folder_path', r.path)
      await runAction('Enregistrement dossier', () => api.settingsSet('backup_folder_path', r.path!), { silent: true })
    }
  }

  const handleRestore = async (backupPath: string, name: string) => {
    if (!confirm(`Restaurer depuis "${name}" ?\n\nL'application va redémarrer automatiquement.`)) return
    setRestoring(backupPath)
    await runAction('Restauration', () => api.backupRestore(backupPath), { silent: true })
    setRestoring(null)
  }

  const copySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL)
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 3000)
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Sync status */}
      <Card>
        <Section title="Synchronisation Supabase">
          {!isSupabaseEnabled ? (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-xs text-orange-800">
              <p className="font-bold flex items-center gap-1"><CloudUpload size={12} /> Sync désactivée</p>
              <p className="mt-1">Configurez <code className="bg-orange-100 px-1 rounded">VITE_SUPABASE_URL</code> et <code className="bg-orange-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> avant <code className="bg-orange-100 px-1 rounded">npm run package</code>.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="bg-muted rounded-lg px-3 py-2 text-center">
                  <p className="text-xs text-text-muted">En attente</p>
                  <p className="font-bold text-lg">{syncPending}</p>
                </div>
                <div className="bg-muted rounded-lg px-3 py-2 text-center">
                  <p className="text-xs text-text-muted">Erreurs</p>
                  <p className={`font-bold text-lg ${syncFailed > 0 ? 'text-red-600' : ''}`}>{syncFailed}</p>
                </div>
                <div className="bg-muted rounded-lg px-3 py-2 text-center">
                  <p className="text-xs text-text-muted">Bootstrap</p>
                  <p className="font-bold text-xs mt-0.5">{bootstrapDone ? '✓ OK' : 'En cours'}</p>
                </div>
              </div>
              {bootstrapErrors && (
                <p className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2 font-mono break-all">{bootstrapErrors}</p>
              )}
              {(() => {
                const lastAt = values.supabase_keepalive_at
                const lastTs = lastAt ? Date.parse(lastAt) : NaN
                const daysSince = Number.isFinite(lastTs) ? (Date.now() - lastTs) / (86400 * 1000) : null
                const stale = daysSince != null && daysSince > 6
                return (
                  <div className={`rounded-xl px-4 py-3 text-xs mb-3 border ${stale ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
                    <p className="font-bold mb-1">Anti-pause Supabase (gratuit)</p>
                    <p>
                      Dernière activité cloud : <strong>{lastAt ? fmtTime(lastTs) : '—'}</strong>
                      {stale && ' — risque de pause Supabase si aucun PC ne tourne !'}
                    </p>
                    <p className="mt-1 text-[10px] opacity-90">
                      SMLPOS envoie un ping toutes les 12h quand l&apos;app tourne. Pour les vacances (&gt;7 jours sans PC),
                      déployez le Worker Cloudflare : <code className="bg-white/60 px-1 rounded">cloudflare/supabase-keepalive</code>
                    </p>
                    {values.supabase_keepalive_error && (
                      <p className="mt-1 text-[10px] font-mono text-red-700 break-all">{values.supabase_keepalive_error}</p>
                    )}
                  </div>
                )
              })()}
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleForceSyncNow} disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 rounded-lg text-xs font-bold">
                  <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sync...' : 'Synchroniser maintenant'}
                </button>
                {syncFailed > 0 && (
                  <button onClick={async () => { await resetFailedItems(); await handleForceSyncNow() }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
                    Réinitialiser erreurs
                  </button>
                )}
              </div>
            </>
          )}
        </Section>
      </Card>

      {/* Emergency recovery */}
      {(recovery && (recovery.activeCount === 0 || recovery.candidates.some(c => c.productCount > recovery.activeCount))) && (
        <Card>
          <Section title="Récupération inventaire (urgence)">
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-red-900 mb-3">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-1">Inventaire perdu ou vide ?</p>
                <p>Base active : <strong>{recovery?.activeCount ?? '—'} produit(s)</strong>. Ci-dessous : copies trouvées sur ce PC (sauvegardes locales, anciens dossiers, dossier externe).</p>
              </div>
            </div>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => void scanRecovery()} disabled={scanningRecovery}
                className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
                <RefreshCw size={12} className={scanningRecovery ? 'animate-spin' : ''} /> Rechercher à nouveau
              </button>
            </div>
            {(recovery?.candidates?.length ?? 0) === 0 ? (
              <p className="text-xs text-text-muted">Aucune copie avec produits trouvée. Vérifiez le dossier externe (Google Drive / USB) ou contactez le support.</p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {recovery!.candidates.map(c => (
                  <div key={c.path} className="flex items-center gap-2 text-xs bg-muted rounded-lg px-3 py-2">
                    <Database size={11} className="text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{c.productCount} produits · {c.source}</p>
                      <p className="font-mono text-[10px] text-text-muted truncate">{c.path}</p>
                    </div>
                    <span className="text-text-muted flex-shrink-0 hidden sm:inline">{fmtTime(c.mtime)}</span>
                    <button type="button" onClick={() => handleRestore(c.path, `${c.productCount} produits`)}
                      disabled={restoring === c.path}
                      className="flex items-center gap-1 px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded font-semibold flex-shrink-0">
                      <RotateCcw size={9} /> Restaurer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </Card>
      )}

      {/* Status banner */}
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <CheckCircle size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-green-800">
          <p className="font-bold mb-0.5">Protection des données active</p>
          <p>Sauvegarde locale toutes les <strong>5 minutes</strong> + snapshot cloud <strong>chaque heure</strong> (30 jours conservés).</p>
          <p className="mt-1">À chaque fermeture, mise à jour et migration, une copie protégée est aussi créée.</p>
          <p className="mt-1">Archive protégée (jamais effacée par reset/mise à jour) : <code className="bg-green-100 px-1 rounded">%APPDATA%\SMLPOS-Archive\</code></p>
          <p className="mt-1">Données live : <code className="bg-green-100 px-1 rounded">%APPDATA%\SMLPOS\</code></p>
        </div>
      </div>

      {/* Backup stats */}
      <Card>
        <Section title="Sauvegardes locales automatiques">
          {stats && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Sauvegardes</p>
                <p className="font-bold text-lg">{stats.count}</p>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Dernière</p>
                <p className="font-bold text-xs mt-0.5">{fmtTime(stats.lastTime)}</p>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Taille DB</p>
                <p className="font-bold">{fmt(stats.dbSize)}</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleCreateBackup} disabled={creating}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 rounded-lg text-xs font-bold transition-colors">
              <HardDrive size={12} /> {creating ? 'Sauvegarde...' : 'Sauvegarder maintenant'}
            </button>
            <button onClick={() => api.backupOpenFolder()}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold transition-colors">
              <FolderOpen size={12} /> Ouvrir le dossier
            </button>
          </div>
          {lastMsg && (
            <p className="text-xs text-green-700 font-semibold bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 mt-2">
              {lastMsg}
            </p>
          )}

          {/* Recent backups list */}
          {backups.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Historique ({backups.length} fichiers) :</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {backups.map(b => (
                  <div key={b.name} className="flex items-center gap-2 text-xs bg-muted rounded-lg px-3 py-1.5">
                    <Database size={11} className="text-text-muted flex-shrink-0" />
                    <span className="flex-1 font-mono truncate text-[10px]">{b.name}</span>
                    <span className="text-text-muted flex-shrink-0">{fmt(b.size)}</span>
                    <span className="text-text-muted flex-shrink-0 hidden sm:inline">{fmtTime(b.time)}</span>
                    <button onClick={() => handleRestore(b.path, b.name)} disabled={restoring === b.path}
                      className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded font-semibold transition-colors flex-shrink-0">
                      <RotateCcw size={9} /> Restaurer
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-1.5 flex items-center gap-1">
                <AlertTriangle size={9} /> Restaurer remplace la base actuelle et redémarre l'application.
              </p>
            </div>
          )}
        </Section>
      </Card>

      {/* External folder */}
      <Card>
        <Section title="Sauvegarde externe (Google Drive / Dropbox / USB)">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-blue-800 mb-3">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>Choisissez un dossier synchronisé avec Google Drive ou Dropbox. La sauvegarde sera automatiquement copiée à chaque sauvegarde locale.</span>
          </div>
          <Field label="Dossier de sauvegarde externe">
            <div className="flex gap-2">
              <div className="flex-1 border border-border rounded-xl px-3 py-2.5 text-sm bg-muted text-text-secondary truncate">
                {values['backup_folder_path'] || 'Aucun dossier sélectionné'}
              </div>
              <button onClick={handleChooseFolder}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 rounded-xl text-sm font-bold transition-colors flex-shrink-0">
                <FolderOpen size={14} /> Choisir
              </button>
            </div>
            {values['backup_folder_path'] && (
              <p className="text-xs text-green-700 font-semibold mt-1.5 flex items-center gap-1">
                <CheckCircle size={11} /> Sauvegarde active vers ce dossier
              </p>
            )}
          </Field>
        </Section>
      </Card>

      {/* Cloudflare R2 snapshots */}
      <Card>
        <Section title="Snapshots cloud (Cloudflare R2)">
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-sky-900 mb-3">
            <CloudUpload size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              Copie horaire de la base SQLite vers le cloud. Conservation <strong>30 jours</strong> (~720 snapshots max).
              Utile si un PC est perdu ou si Supabase et la copie locale ne suffisent pas.
            </span>
          </div>

          {r2Status && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Statut</p>
                <p className={`font-bold text-xs mt-0.5 ${r2Status.configured && r2Status.enabled ? 'text-green-700' : 'text-orange-700'}`}>
                  {!r2Status.configured ? 'Non configuré' : r2Status.enabled ? 'Actif' : 'Désactivé'}
                </p>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Dernier envoi</p>
                <p className="font-bold text-xs mt-0.5">{fmtTime(r2Status.lastUploadAt)}</p>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Snapshots (30j)</p>
                <p className="font-bold text-lg">{r2Status.snapshotCount}</p>
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 text-center">
                <p className="text-xs text-text-muted">Prochain envoi</p>
                <p className="font-bold text-xs mt-0.5">
                  {r2Status.nextUploadInMs == null
                    ? '—'
                    : r2Status.nextUploadInMs <= 0
                      ? 'Bientôt'
                      : `${Math.ceil(r2Status.nextUploadInMs / 60000)} min`}
                </p>
              </div>
            </div>
          )}

          {r2Status?.lastError && (
            <p className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 font-mono break-all">
              {r2Status.lastError}
            </p>
          )}

          <Toggle label="Activer les snapshots cloud" checked={values.r2_enabled === 'true'} onChange={() => set('r2_enabled', values.r2_enabled === 'true' ? 'false' : 'true')} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="Endpoint S3 R2">
              <TextInput value={values.r2_endpoint} onChange={v => set('r2_endpoint', v)} placeholder="https://….r2.cloudflarestorage.com" />
            </Field>
            <Field label="Bucket">
              <TextInput value={values.r2_bucket} onChange={v => set('r2_bucket', v)} placeholder="smlpos" />
            </Field>
            <Field label="Access Key ID">
              <TextInput value={values.r2_access_key_id} onChange={v => set('r2_access_key_id', v)} placeholder="053d…" />
            </Field>
            <Field label="Secret Access Key">
              <div className="relative">
                <TextInput
                  value={values.r2_secret_access_key}
                  onChange={v => set('r2_secret_access_key', v)}
                  type={showR2Secret ? 'text' : 'password'}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowR2Secret(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                  {showR2Secret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
          </div>

          {r2Status?.machineId && (
            <p className="text-[10px] text-text-muted mt-2 font-mono">PC : {r2Status.machineId}</p>
          )}

          <div className="flex gap-2 flex-wrap mt-3">
            <button type="button" onClick={handleSaveR2}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <Save size={12} /> Enregistrer config
            </button>
            <button type="button" onClick={handleR2Test} disabled={r2Testing}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <CheckCircle size={12} className={r2Testing ? 'animate-pulse' : ''} /> Tester connexion
            </button>
            <button type="button" onClick={handleR2Upload} disabled={r2Uploading}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-gray-200 rounded-lg text-xs font-bold">
              <CloudUpload size={12} className={r2Uploading ? 'animate-pulse' : ''} /> {r2Uploading ? 'Envoi…' : 'Envoyer maintenant'}
            </button>
            <button type="button" onClick={() => void loadR2()} disabled={r2Loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-border rounded-lg text-xs font-semibold">
              <RefreshCw size={12} className={r2Loading ? 'animate-spin' : ''} /> Actualiser liste
            </button>
          </div>

          {r2Snapshots.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold text-text-secondary mb-2">
                Snapshots cloud ({r2Snapshots.length} — dernières 30 jours) :
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {r2Snapshots.map(s => (
                  <div key={s.key} className="flex items-center gap-2 text-xs bg-muted rounded-lg px-3 py-1.5">
                    <CloudUpload size={11} className="text-sky-600 flex-shrink-0" />
                    <span className="flex-1 font-semibold truncate">{s.label}</span>
                    <span className="text-text-muted flex-shrink-0">{fmt(s.size)}</span>
                    <span className="text-text-muted flex-shrink-0 hidden sm:inline">{fmtTime(s.lastModified)}</span>
                    <button type="button" onClick={() => handleR2Restore(s.key, s.label)}
                      disabled={restoringR2 === s.key}
                      className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded font-semibold flex-shrink-0">
                      <RotateCcw size={9} /> Restaurer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted mt-3">
              {r2Status?.configured
                ? 'Aucun snapshot cloud pour ce PC. Cliquez « Envoyer maintenant » ou attendez la prochaine sauvegarde horaire.'
                : 'Renseignez les clés R2 puis enregistrez pour activer les snapshots horaires.'}
            </p>
          )}
        </Section>
      </Card>

      {/* Supabase migration */}
      <Card>
        <Section title="Créer les tables Supabase (sync cloud)">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2 text-xs text-red-800 mb-3">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span><strong>Les tables Supabase n'existent pas encore</strong> — c'est pourquoi le sync échoue. Copiez le SQL ci-dessous et exécutez-le dans <strong>Supabase Dashboard → SQL Editor</strong>.</span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-secondary">Migration SQL (toutes les tables) :</p>
            <button onClick={copySql}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                copiedSql ? 'bg-green-500 text-white' : 'bg-accent-500 hover:bg-accent-600')}>
              {copiedSql ? <><Check size={11} /> Copié !</> : <><Copy size={11} /> Copier le SQL</>}
            </button>
          </div>
          <pre className="text-[9px] font-mono bg-gray-900 text-green-400 rounded-xl p-3 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap">
            {SUPABASE_SQL.slice(0, 300)}...
          </pre>
          <p className="text-xs text-text-muted mt-2 flex items-center gap-1">
            <CloudUpload size={11} /> Après exécution, les erreurs de sync disparaîtront et les données seront synchronisées automatiquement.
          </p>
        </Section>
      </Card>

      {/* Timing info */}
      <Card>
        <Section title="Planification des sauvegardes">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="flex items-center gap-2 text-text-secondary"><Clock size={12} /> Au démarrage</span>
              <span className="font-semibold text-green-700">✓ Sauvegarde automatique</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="flex items-center gap-2 text-text-secondary"><Clock size={12} /> Toutes les 5 minutes</span>
              <span className="font-semibold text-green-700">✓ Sauvegarde automatique</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="flex items-center gap-2 text-text-secondary"><Clock size={12} /> Cloud R2 (horaire)</span>
              <span className="font-semibold text-green-700">✓ 30 jours conservés</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="flex items-center gap-2 text-text-secondary"><HardDrive size={12} /> Fichiers locaux</span>
              <span className="font-semibold">30 dernières sauvegardes</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="flex items-center gap-2 text-text-secondary"><Database size={12} /> Chemin DB</span>
              <span className="font-mono text-[10px] text-text-muted truncate max-w-[220px]">{stats?.dbPath ?? '...'}</span>
            </div>
          </div>
        </Section>
      </Card>
    </div>
  )
}

function UpdateCheckButton() {
  const [checking, setChecking] = useState(false)
  return (
    <button
      type="button"
      disabled={checking}
      onClick={async () => {
        if (!api.updateCheck) {
          showToast('info', 'Disponible uniquement dans l\'application installée')
          return
        }
        setChecking(true)
        await api.updateCheck(true)
        setChecking(false)
      }}
      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-accent-500 hover:bg-accent-600 disabled:opacity-50 rounded-xl"
    >
      <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
      {checking ? 'Vérification…' : 'Vérifier les mises à jour'}
    </button>
  )
}
