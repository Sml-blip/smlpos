import { useEffect, useState } from 'react'
import type { LabelPrintConfig, LabelTextAlign } from '../lib/printManager'

type Variant = 'modal' | 'settings'

interface LabelBarcodeSettingsFormProps {
  config: LabelPrintConfig
  onChange: (patch: Partial<LabelPrintConfig>) => void
  variant?: Variant
  saveState?: 'idle' | 'saving' | 'saved'
}

interface NumInputProps {
  value: number
  onCommit: (value: number) => void
  min: number
  max: number
  decimals?: number
  className?: string
}

/** Text input with local draft — fixes broken typing on controlled number fields. */
function NumInput({ value, onCommit, min, max, decimals = 1, className }: NumInputProps) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(formatDraft(value, decimals))
  }, [value, focused, decimals])

  function formatDraft(n: number, d: number): string {
    return d === 0 ? String(Math.round(n)) : String(Number(n.toFixed(d)))
  }

  function commit(raw: string) {
    const t = raw.trim().replace(',', '.')
    if (!t || t === '.' || t === '-') {
      setDraft(formatDraft(value, decimals))
      return
    }
    const n = parseFloat(t)
    if (!Number.isFinite(n)) {
      setDraft(formatDraft(value, decimals))
      return
    }
    const clamped = Math.min(max, Math.max(min, Number(n.toFixed(decimals))))
    onCommit(clamped)
    setDraft(formatDraft(clamped, decimals))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        }
      }}
      onChange={(e) => setDraft(e.target.value)}
    />
  )
}

export default function LabelBarcodeSettingsForm({
  config: cfg,
  onChange,
  variant = 'settings',
  saveState = 'idle',
}: LabelBarcodeSettingsFormProps) {
  const compact = variant === 'modal'

  const sectionClass = compact
    ? 'mb-3 pb-3 border-b border-border/60 last:border-0 last:pb-0'
    : 'space-y-3'
  const sectionTitle = compact
    ? 'text-[10px] font-bold uppercase tracking-wide text-text-secondary mb-2'
    : 'text-xs font-bold uppercase tracking-wide text-text-secondary'
  const gridClass = compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-4'
  const inputClass = compact
    ? 'w-full border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent-500 bg-white'
    : 'w-full border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent-500 bg-white'
  const labelClass = compact
    ? 'block text-[10px] font-semibold text-text-secondary mb-0.5'
    : 'block text-xs font-semibold text-text-secondary mb-1'
  const toggleRow = compact ? 'flex items-center justify-between gap-2 py-1' : 'flex items-center justify-between gap-3 py-1.5'

  const set = <K extends keyof LabelPrintConfig>(key: K, val: LabelPrintConfig[K]) => {
    onChange({ [key]: val })
  }

  return (
    <div className={compact ? 'text-xs' : ''}>
      {saveState !== 'idle' && (
        <div className={`mb-2 text-[10px] font-semibold ${saveState === 'saved' ? 'text-green-700' : 'text-text-secondary'}`}>
          {saveState === 'saving' ? 'Enregistrement…' : 'Paramètres enregistrés'}
        </div>
      )}

      <div className={sectionClass}>
        <div className={sectionTitle}>Échelle contenu</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className={labelClass.replace(' mb-0.5', '').replace(' mb-1', '')}>
              Taille globale · {cfg.contentScalePct}%
            </label>
            <span className="text-[10px] font-bold text-text-primary tabular-nums">{cfg.contentScalePct}%</span>
          </div>
          <input
            type="range"
            min={70}
            max={200}
            step={1}
            value={cfg.contentScalePct}
            className="w-full accent-accent-500"
            onChange={(e) => set('contentScalePct', parseInt(e.target.value, 10))}
          />
          <div className="flex justify-between text-[9px] text-text-secondary">
            <span>70%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className={sectionTitle}>Format étiquette</div>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>Largeur (mm)</label>
            <NumInput value={cfg.widthMm} min={10} max={120} decimals={1} className={inputClass}
              onCommit={(v) => set('widthMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Hauteur (mm)</label>
            <NumInput value={cfg.heightMm} min={5} max={80} decimals={1} className={inputClass}
              onCommit={(v) => set('heightMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Marge gauche (mm)</label>
            <NumInput value={cfg.stripLeftMm} min={0} max={20} decimals={1} className={inputClass}
              onCommit={(v) => set('stripLeftMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Marge droite (mm)</label>
            <NumInput value={cfg.stripRightMm} min={0} max={20} decimals={1} className={inputClass}
              onCommit={(v) => set('stripRightMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Marge haut (mm)</label>
            <NumInput value={cfg.stripTopMm} min={0} max={10} decimals={1} className={inputClass}
              onCommit={(v) => set('stripTopMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Marge bas (mm)</label>
            <NumInput value={cfg.stripBottomMm} min={0} max={10} decimals={1} className={inputClass}
              onCommit={(v) => set('stripBottomMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Rotation</label>
            <select value={String(cfg.rotationDeg)} className={inputClass}
              onChange={e => set('rotationDeg', parseInt(e.target.value, 10) === 180 ? 180 : 0)}>
              <option value="0">0° (normal)</option>
              <option value="180">180° (retourné)</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Alignement texte</label>
            <select value={cfg.textAlign} className={inputClass}
              onChange={e => set('textAlign', e.target.value as LabelTextAlign)}>
              <option value="auto">Auto (selon rotation)</option>
              <option value="left">Gauche</option>
              <option value="center">Centré</option>
              <option value="right">Droite</option>
            </select>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className={sectionTitle}>Code-barres</div>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>Hauteur barres (mm)</label>
            <NumInput value={cfg.barHeightMm} min={3} max={15} decimals={1} className={inputClass}
              onCommit={(v) => set('barHeightMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Marge latérale code (mm)</label>
            <NumInput value={cfg.barMarginMm} min={0} max={15} decimals={1} className={inputClass}
              onCommit={(v) => set('barMarginMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Épaisseur barres max (mm)</label>
            <NumInput value={cfg.moduleWidthMaxMm} min={0.15} max={0.6} decimals={2} className={inputClass}
              onCommit={(v) => set('moduleWidthMaxMm', v)} />
          </div>
          <div className={toggleRow}>
            <span className="text-[10px] font-semibold text-text-secondary">Numéro sous le code</span>
            <input type="checkbox" checked={cfg.showBarcodeText}
              onChange={e => set('showBarcodeText', e.target.checked)} />
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className={sectionTitle}>Espacement vertical</div>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>Nom → code-barres (mm)</label>
            <NumInput value={cfg.gapNameBarcodeMm} min={0} max={8} decimals={1} className={inputClass}
              onCommit={(v) => set('gapNameBarcodeMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Code-barres → prix (mm)</label>
            <NumInput value={cfg.gapBarcodePriceMm} min={0} max={8} decimals={1} className={inputClass}
              onCommit={(v) => set('gapBarcodePriceMm', v)} />
          </div>
          <div>
            <label className={labelClass}>Position verticale</label>
            <select value={cfg.contentVAlign} className={inputClass}
              onChange={e => set('contentVAlign', e.target.value as LabelPrintConfig['contentVAlign'])}>
              <option value="top">Haut (compact)</option>
              <option value="center">Centré</option>
              <option value="bottom">Bas</option>
              <option value="space-between">Réparti</option>
            </select>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className={sectionTitle}>Contenu</div>
        <div className={gridClass}>
          <div className={toggleRow}>
            <span className="text-[10px] font-semibold text-text-secondary">Nom produit</span>
            <input type="checkbox" checked={cfg.showName} onChange={e => set('showName', e.target.checked)} />
          </div>
          <div className={toggleRow}>
            <span className="text-[10px] font-semibold text-text-secondary">Prix</span>
            <input type="checkbox" checked={cfg.showPrice} onChange={e => set('showPrice', e.target.checked)} />
          </div>
          <div>
            <label className={labelClass}>Police nom (pt)</label>
            <NumInput value={cfg.nameFontPt} min={4} max={12} decimals={1} className={inputClass}
              onCommit={(v) => set('nameFontPt', v)} />
          </div>
          <div>
            <label className={labelClass}>Police prix (pt)</label>
            <NumInput value={cfg.priceFontPt} min={5} max={14} decimals={1} className={inputClass}
              onCommit={(v) => set('priceFontPt', v)} />
          </div>
          <div>
            <label className={labelClass}>Lignes nom max</label>
            <select value={String(cfg.nameMaxLines)} className={inputClass}
              onChange={e => set('nameMaxLines', parseInt(e.target.value, 10) === 1 ? 1 : parseInt(e.target.value, 10) === 3 ? 3 : 2)}>
              <option value="1">1 ligne</option>
              <option value="2">2 lignes</option>
              <option value="3">3 lignes</option>
            </select>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className={sectionTitle}>Impression</div>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>Résolution DPI</label>
            <NumInput value={cfg.dpi} min={72} max={600} decimals={0} className={inputClass}
              onCommit={(v) => set('dpi', Math.round(v))} />
          </div>
          <div>
            <label className={labelClass}>Copies par défaut</label>
            <NumInput value={cfg.defaultCopies} min={1} max={99} decimals={0} className={inputClass}
              onCommit={(v) => set('defaultCopies', Math.round(v))} />
          </div>
        </div>
        {!compact && (
          <p className="text-[11px] text-text-secondary mt-2">
            Les réglages sont enregistrés automatiquement. Utilisez « Test étiquette » pour vérifier le rendu.
          </p>
        )}
      </div>
    </div>
  )
}

export function labelConfigPatchToSettings(patch: Partial<LabelPrintConfig>, current: LabelPrintConfig): Record<string, string> {
  const merged = { ...current, ...patch }
  return {
    impression_label_width: String(merged.widthMm),
    impression_label_height: String(merged.heightMm),
    impression_label_strip_left: String(merged.stripLeftMm),
    impression_label_strip_right: String(merged.stripRightMm),
    impression_label_strip_top: String(merged.stripTopMm),
    impression_label_strip_bottom: String(merged.stripBottomMm),
    impression_label_rotation: String(merged.rotationDeg),
    impression_label_bar_height: String(merged.barHeightMm),
    impression_label_bar_margin: String(merged.barMarginMm),
    impression_label_module_max: String(merged.moduleWidthMaxMm),
    impression_label_show_name: String(merged.showName),
    impression_label_show_price: String(merged.showPrice),
    impression_label_show_barcode_text: String(merged.showBarcodeText),
    impression_label_name_font: String(merged.nameFontPt),
    impression_label_price_font: String(merged.priceFontPt),
    impression_label_name_lines: String(merged.nameMaxLines),
    impression_label_align: merged.textAlign,
    impression_label_dpi: String(merged.dpi),
    impression_label_copies: String(merged.defaultCopies),
    impression_label_gap_name_bar: String(merged.gapNameBarcodeMm),
    impression_label_gap_bar_price: String(merged.gapBarcodePriceMm),
    impression_label_valign: merged.contentVAlign,
    impression_label_content_scale: String(merged.contentScalePct),
  }
}
