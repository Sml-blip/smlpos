import { useState, useEffect } from 'react'
import { X, Save, RefreshCw, Eye, FileText } from 'lucide-react'
import { cn } from '../../lib/utils'
import { loadData, runAction } from '../../lib/apiCall'
import InvoicePrintTemplate from '../../components/InvoicePrintTemplate'
import type { InvoiceDocData, InvoiceLineData } from '../../components/InvoicePrintTemplate'
import { INVOICE_COMPANY } from '../../lib/invoiceCompany'

const api = window.api

// ── Mock data for preview (realistic SML invoice) ───────────────────────────
const MOCK_DOC: InvoiceDocData = {
  numero: 'FAC-20260506-001',
  type_document: 'FACTURE_VENTE',
  client_nom: 'Pharmacie Hamroun Mohamed',
  client_tel: '71 234 567',
  client_adresse: 'Av. Habib Bourguiba, Tajerouine',
  client_matricule: '1937965/LP/C/000',
  total_ht: 84.220,
  total_tva: 14.780,
  total_ttc: 99.000,
  statut_paiement: 'PAYE',
  date_echeance: null,
  created_at: new Date().toISOString(),
}

const MOCK_LIGNES: InvoiceLineData[] = [
  {
    id: '1',
    designation: 'HUB USB Ethernet 10/100/1000 Mbps',
    quantite: 1,
    prix_unitaire: 74.790,
    remise_pct: 1,
    tva_taux: 19,
    total_ht: 74.042,
    total_tva: 14.068,
    total_ttc: 88.110,
  },
  {
    id: '2',
    designation: 'Flash Disque 16GB 2.0 PD13',
    quantite: 1,
    prix_unitaire: 10.280,
    remise_pct: 1,
    tva_taux: 7,
    total_ht: 10.178,
    total_tva: 0.712,
    total_ttc: 10.890,
  },
]

interface TemplateConfig {
  primaryColor: string
  showTva: boolean
  showFooter: boolean
  showTimbre: boolean
  showWatermark: boolean
  watermarkText: string
  watermarkOpacity: number
  watermarkAngle: number
}

const DEFAULT_CONFIG: TemplateConfig = {
  primaryColor: '#F59E0B',
  showTva: true,
  showFooter: true,
  showTimbre: true,
  showWatermark: true,
  watermarkText: 'SML',
  watermarkOpacity: 7,
  watermarkAngle: -32,
}

interface Props {
  onClose: () => void
}

export default function InvoiceTemplateEditor({ onClose }: Props) {
  const [config, setConfig] = useState<TemplateConfig>(DEFAULT_CONFIG)
  const [companySettings, setCompanySettings] = useState<Record<string, string>>({
    company_name: INVOICE_COMPANY.name,
    company_subtitle: INVOICE_COMPANY.subtitle,
    company_address: `${INVOICE_COMPANY.address} — ${INVOICE_COMPANY.city}`,
    company_phone: INVOICE_COMPANY.phone,
    company_matricule: INVOICE_COMPANY.matricule,
    company_rib: INVOICE_COMPANY.rib,
    company_logo: INVOICE_COMPANY.logo,
    invoice_footer: INVOICE_COMPANY.footer,
    invoice_timbre_fiscal: 'true',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadData('Chargement modèle facture', async () => {
      const all = await api.settingsGetAll() as Record<string, string>
      setCompanySettings(prev => ({
        ...prev,
        invoice_footer: all.invoice_footer ?? prev.invoice_footer,
        invoice_show_tva: all.invoice_show_tva ?? 'true',
        invoice_timbre_fiscal: all.invoice_timbre_fiscal ?? 'true',
      }))
      if (all.invoice_template_json && all.invoice_template_json !== '{}') {
        try {
          const parsed = JSON.parse(all.invoice_template_json)
          setConfig(prev => ({ ...prev, ...parsed }))
        } catch { /* ignore invalid json */ }
      }
      return all
    }, { silent: true })
  }, [])

  const set = <K extends keyof TemplateConfig>(k: K, v: TemplateConfig[K]) =>
    setConfig(prev => ({ ...prev, [k]: v }))

  const handleSave = async () => {
    await runAction('Enregistrement modèle', async () => {
      await api.settingsSet('invoice_template_json', JSON.stringify(config))
      await api.settingsSet('invoice_primary_color', config.primaryColor)
      await api.settingsSet('invoice_show_tva', config.showTva ? 'true' : 'false')
      await api.settingsSet('invoice_timbre_fiscal', config.showTimbre ? 'true' : 'false')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, { setSaving, successMessage: 'Modèle enregistré' })
  }

  // Build preview settings from company settings + template config
  const previewSettings = {
    ...companySettings,
    invoice_primary_color: config.primaryColor,
    invoice_show_tva: config.showTva ? 'true' : 'false',
    invoice_timbre_fiscal: config.showTimbre ? 'true' : 'false',
    invoice_template_json: JSON.stringify(config),
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-100 flex items-center justify-center">
              <FileText size={18} className="text-accent-600" />
            </div>
            <div>
              <h2 className="font-bold text-base">Éditeur de Modèle Facture A4</h2>
              <p className="text-xs text-text-muted">Personnalisez l'apparence de vos factures, devis et bons de livraison</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors',
                saved ? 'bg-green-500 text-white' : 'bg-accent-500 hover:bg-accent-600 text-text-primary'
              )}
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saved ? 'Sauvegardé !' : 'Enregistrer'}
            </button>
            <button type="button" onClick={onClose} className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">

          {/* Controls panel */}
          <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-5">

            {/* Primary color */}
            <div>
              <label className="block text-xs font-bold text-text-primary mb-2 uppercase tracking-wider">Couleur principale</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={config.primaryColor}
                  onChange={e => set('primaryColor', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                />
                <input
                  type="text"
                  value={config.primaryColor}
                  onChange={e => set('primaryColor', e.target.value)}
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent-500"
                />
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {['#F59E0B', '#2563EB', '#16A34A', '#DC2626', '#7C3AED', '#000000'].map(c => (
                  <button
                    key={c}
                    onClick={() => set('primaryColor', c)}
                    className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            {/* Sections */}
            <div>
              <label className="block text-xs font-bold text-text-primary mb-2 uppercase tracking-wider">Affichage</label>
              <div className="space-y-3">
                {[
                  { key: 'showTva' as const, label: 'Détail TVA & colonnes TVA' },
                  { key: 'showTimbre' as const, label: 'Timbre fiscal (1.000 DT)' },
                  { key: 'showFooter' as const, label: 'Pied de page' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between gap-2 cursor-pointer group">
                    <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{label}</span>
                    <button
                      onClick={() => set(key, !config[key])}
                      className={cn(
                        'w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                        config[key] ? 'bg-accent-500' : 'bg-gray-200'
                      )}
                    >
                      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', config[key] ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-text-primary mb-2 uppercase tracking-wider">Filigrane</label>
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-2 cursor-pointer group">
                  <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">Afficher filigrane</span>
                  <button
                    type="button"
                    onClick={() => set('showWatermark', !config.showWatermark)}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                      config.showWatermark ? 'bg-accent-500' : 'bg-gray-200',
                    )}
                  >
                    <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', config.showWatermark ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </label>
                {config.showWatermark && (
                  <>
                    <div>
                      <label className="block text-[11px] font-medium text-text-secondary mb-1">Texte (majuscules)</label>
                      <input
                        type="text"
                        value={config.watermarkText}
                        onChange={e => set('watermarkText', e.target.value.toUpperCase().slice(0, 12))}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm font-bold uppercase outline-none focus:border-accent-500"
                        placeholder="SML"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-text-secondary mb-1">
                        Opacité — {config.watermarkOpacity}%
                      </label>
                      <input
                        type="range"
                        min={2}
                        max={20}
                        value={config.watermarkOpacity}
                        onChange={e => set('watermarkOpacity', parseInt(e.target.value, 10))}
                        className="w-full accent-accent-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-text-secondary mb-1">
                        Inclinaison — {config.watermarkAngle}°
                      </label>
                      <input
                        type="range"
                        min={-55}
                        max={-15}
                        value={config.watermarkAngle}
                        onChange={e => set('watermarkAngle', parseInt(e.target.value, 10))}
                        className="w-full accent-accent-500"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="text-xs text-text-muted bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="font-semibold text-amber-700 mb-1">Infos entreprise</p>
              <p>Le nom, adresse, MF, RIB et pied de page sont configurés dans <strong>Paramètres › Entreprise</strong>.</p>
            </div>
          </div>

          {/* Live preview */}
          <div className="flex-1 overflow-auto bg-gray-100 p-4 flex flex-col items-center">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-3">
              <Eye size={12} />
              Aperçu A4 — données de démonstration
            </div>
            <div
              style={{
                transform: 'scale(0.68)',
                transformOrigin: 'top center',
                marginBottom: '-260px',
                pointerEvents: 'none',
              }}
            >
              <InvoicePrintTemplate
                doc={MOCK_DOC}
                lignes={MOCK_LIGNES}
                settings={previewSettings}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
