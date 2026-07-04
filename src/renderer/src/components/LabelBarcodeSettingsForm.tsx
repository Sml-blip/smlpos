import type { LabelPrintConfig, LabelTextAlign } from '../lib/printManager'

type Variant = 'modal' | 'settings'

interface LabelBarcodeSettingsFormProps {
  config: LabelPrintConfig
  onChange: (patch: Partial<LabelPrintConfig>) => void
  variant?: Variant
  saveState?: 'idle' | 'saving' | 'saved'
}

function num(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  decimals = 1,
): number {
  const n = parseFloat(raw.replace(',', '.'))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Number(n.toFixed(decimals))))
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
        <div className={sectionTitle}>Format étiquette</div>
        <div className={gridClass}>
          <div>
            <label className={labelClass}>Largeur (mm)</label>
            <input type="number" min={10} max={120} step={0.1} value={cfg.widthMm} className={inputClass}
              onChange={e => set('widthMm', num(e.target.value, cfg.widthMm, 10, 120))} />
          </div>
          <div>
            <label className={labelClass}>Hauteur (mm)</label>
            <input type="number" min={5} max={80} step={0.1} value={cfg.heightMm} className={inputClass}
              onChange={e => set('heightMm', num(e.target.value, cfg.heightMm, 5, 80))} />
          </div>
          <div>
            <label className={labelClass}>Marge gauche (mm)</label>
            <input type="number" min={0} max={20} step={0.1} value={cfg.stripLeftMm} className={inputClass}
              onChange={e => set('stripLeftMm', num(e.target.value, cfg.stripLeftMm, 0, 20))} />
          </div>
          <div>
            <label className={labelClass}>Marge droite (mm)</label>
            <input type="number" min={0} max={20} step={0.1} value={cfg.stripRightMm} className={inputClass}
              onChange={e => set('stripRightMm', num(e.target.value, cfg.stripRightMm, 0, 20))} />
          </div>
          <div>
            <label className={labelClass}>Marge haut (mm)</label>
            <input type="number" min={0} max={10} step={0.1} value={cfg.stripTopMm} className={inputClass}
              onChange={e => set('stripTopMm', num(e.target.value, cfg.stripTopMm, 0, 10))} />
          </div>
          <div>
            <label className={labelClass}>Marge bas (mm)</label>
            <input type="number" min={0} max={10} step={0.1} value={cfg.stripBottomMm} className={inputClass}
              onChange={e => set('stripBottomMm', num(e.target.value, cfg.stripBottomMm, 0, 10))} />
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
            <input type="number" min={3} max={15} step={0.1} value={cfg.barHeightMm} className={inputClass}
              onChange={e => set('barHeightMm', num(e.target.value, cfg.barHeightMm, 3, 15))} />
          </div>
          <div>
            <label className={labelClass}>Marge latérale code (mm)</label>
            <input type="number" min={0} max={15} step={0.1} value={cfg.barMarginMm} className={inputClass}
              onChange={e => set('barMarginMm', num(e.target.value, cfg.barMarginMm, 0, 15))} />
          </div>
          <div>
            <label className={labelClass}>Épaisseur barres max (mm)</label>
            <input type="number" min={0.15} max={0.6} step={0.01} value={cfg.moduleWidthMaxMm} className={inputClass}
              onChange={e => set('moduleWidthMaxMm', num(e.target.value, cfg.moduleWidthMaxMm, 0.15, 0.6, 2))} />
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
            <input type="number" min={0} max={8} step={0.1} value={cfg.gapNameBarcodeMm} className={inputClass}
              onChange={e => set('gapNameBarcodeMm', num(e.target.value, cfg.gapNameBarcodeMm, 0, 8))} />
          </div>
          <div>
            <label className={labelClass}>Code-barres → prix (mm)</label>
            <input type="number" min={0} max={8} step={0.1} value={cfg.gapBarcodePriceMm} className={inputClass}
              onChange={e => set('gapBarcodePriceMm', num(e.target.value, cfg.gapBarcodePriceMm, 0, 8))} />
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
            <input type="number" min={4} max={12} step={0.5} value={cfg.nameFontPt} className={inputClass}
              onChange={e => set('nameFontPt', num(e.target.value, cfg.nameFontPt, 4, 12, 1))} />
          </div>
          <div>
            <label className={labelClass}>Police prix (pt)</label>
            <input type="number" min={5} max={14} step={0.5} value={cfg.priceFontPt} className={inputClass}
              onChange={e => set('priceFontPt', num(e.target.value, cfg.priceFontPt, 5, 14, 1))} />
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
            <input type="number" min={72} max={600} step={1} value={cfg.dpi} className={inputClass}
              onChange={e => set('dpi', Math.round(num(e.target.value, cfg.dpi, 72, 600, 0)))} />
          </div>
          <div>
            <label className={labelClass}>Copies par défaut</label>
            <input type="number" min={1} max={99} step={1} value={cfg.defaultCopies} className={inputClass}
              onChange={e => set('defaultCopies', Math.round(num(e.target.value, cfg.defaultCopies, 1, 99, 0)))} />
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
  }
}
