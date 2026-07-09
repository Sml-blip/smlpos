/**
 * PrintManagerModal.tsx
 *
 * Context-specific in-app print manager for Electron POS.
 * Modes: document (A4), label (Gainscha-style), ticket (thermal).
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import {
  type PrintKind,
  type PrintSettingsKey,
  type LabelPrintConfig,
  inferPrintKind,
  defaultSettingsKey,
} from '../lib/printManager'
import {
  loadLabelPrintConfig,
  saveLabelPrintConfig,
  mergeLabelConfig,
  scheduleSaveLabelPrintConfig,
} from '../lib/labelSettings'
import { buildBarcodeLabelHtml } from '../lib/barcodeLabel'
import { buildGainschaPrintJob } from '../lib/gainschaLabelJob'
import LabelVisualEditor from './LabelVisualEditor'

const api = window.api

// ─── Types ────────────────────────────────────────────────────────────────────

export type NativePageSize = 'A4' | 'A5' | '58mm' | '80mm' | '40x20mm'
export type Orientation = 'portrait' | 'landscape'

export interface PrintOptions {
  printerName: string
  pageSize: NativePageSize
  orientation: Orientation
  color: boolean
  printBackground: boolean
  silent: boolean
  copies: number
  margins: { top: number; bottom: number; left: number; right: number }
  scale: number
}

export interface PrintProfile {
  label: string
  options: Partial<PrintOptions>
}

export interface PrintManagerModalProps {
  html: string
  printKind?: PrintKind
  defaultPageSize?: NativePageSize
  settingsKey?: PrintSettingsKey
  labelConfig?: Partial<LabelPrintConfig>
  labelSource?: { code: string; nom: string; prix: number; productRef?: string }
  onClose: () => void
  extraProfiles?: PrintProfile[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_DIMS_MM: Record<NativePageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  '58mm': { w: 58, h: 200 },
  '80mm': { w: 80, h: 200 },
  '40x20mm': { w: 40, h: 20 },
}

const MM_TO_PX = 3.7795275591

const MODE_HEADERS: Record<PrintKind, string> = {
  document: 'Impression document A4',
  label: 'Impression étiquette',
  ticket: 'Impression ticket',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

/** Wrap inner HTML fragments for document preview/print only. */
function wrapFragment(html: string, margins: PrintOptions['margins'], pageSize: NativePageSize): string {
  if (html.trimStart().startsWith('<!DOCTYPE') || html.trimStart().startsWith('<html')) {
    return html
  }
  const { top, bottom, left, right } = margins
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body {
    margin: ${top}mm ${right}mm ${bottom}mm ${left}mm;
    font-family: sans-serif;
    font-size: 12px;
  }
  @page {
    size: ${pageSize};
    margin: ${top}mm ${right}mm ${bottom}mm ${left}mm;
  }
</style>
</head>
<body>${html}</body>
</html>`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  id: string
}

function Toggle({ checked, onChange, label, id }: ToggleProps) {
  return (
    <div style={styles.toggleRow}>
      <label htmlFor={id} style={styles.toggleLabel}>{label}</label>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          ...styles.toggleTrack,
          background: checked ? '#3B6D11' : 'var(--color-border-secondary)',
        }}
      >
        <span
          style={{
            ...styles.toggleThumb,
            transform: checked ? 'translateX(14px)' : 'translateX(0)',
          }}
        />
      </button>
    </div>
  )
}

interface IconBtnProps {
  onClick: () => void
  title?: string
  children: React.ReactNode
  style?: React.CSSProperties
}

function IconBtn({ onClick, title, children, style }: IconBtnProps) {
  return (
    <button type="button" onClick={onClick} title={title} style={{ ...styles.iconBtn, ...style }}>
      {children}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PrintManagerModal({
  html,
  printKind: printKindProp,
  defaultPageSize = 'A4',
  settingsKey: settingsKeyProp,
  labelConfig,
  labelSource,
  onClose,
}: PrintManagerModalProps) {
  const kind = useMemo(
    () => inferPrintKind({ printKind: printKindProp, defaultPageSize }),
    [printKindProp, defaultPageSize],
  )
  const settingsKey = settingsKeyProp ?? defaultSettingsKey(kind)

  // ── State ──────────────────────────────────────────────────────────────────

  const [tab, setTab] = useState<'general' | 'advanced'>('general')
  const [printers, setPrinters] = useState<string[]>([])
  const [printersLoading, setPrintersLoading] = useState(true)

  const [opts, setOpts] = useState<PrintOptions>({
    printerName: '',
    pageSize: kind === 'document' ? 'A4' : defaultPageSize,
    orientation: 'portrait',
    color: kind !== 'ticket',
    printBackground: true,
    silent: true,
    copies: 1,
    margins: { top: 8, bottom: 8, left: 8, right: 8 },
    scale: 100,
  })

  const [labelCfg, setLabelCfg] = useState<LabelPrintConfig>(() => mergeLabelConfig(labelConfig))
  const [labelSaveState, setLabelSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const labelHydratedRef = useRef(false)
  const [ticketWidthMm, setTicketWidthMm] = useState<58 | 80>(80)
  const [gainschaAvailable, setGainschaAvailable] = useState(false)
  const [gainschaUsbDevices, setGainschaUsbDevices] = useState<string[]>([])
  const [gainschaSdkVer, setGainschaSdkVer] = useState('')

  const [zoom, setZoom] = useState(() => (kind === 'label' ? 300 : 75))
  const [printing, setPrinting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Prêt')
  const [statusOk, setStatusOk] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages] = useState(1)

  const frameRef = useRef<HTMLIFrameElement>(null)

  // ── Load printers + saved settings on mount ────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = ((await api.getPrinters?.()) ?? []) as { name: string }[]
        if (cancelled) return
        const names = list.map((p) => p.name).filter(Boolean)
        setPrinters(names)

        let savedPrinter = ''
        let allSettings: Record<string, string> = {}
        try {
          allSettings = (await api.settingsGetAll()) as Record<string, string>
          savedPrinter = settingsKey ? (allSettings[settingsKey] ?? '') : ''
        } catch {
          // settings unavailable — non-fatal
        }

        const defaultPrinter = savedPrinter && names.includes(savedPrinter)
          ? savedPrinter
          : names[0] ?? ''

        setOpts((prev) => ({ ...prev, printerName: defaultPrinter }))

        if (kind === 'ticket') {
          const w = parseInt(allSettings.impression_largeur ?? '80', 10)
          setTicketWidthMm(w === 58 ? 58 : 80)
        }

        if (kind === 'label') {
          const loaded = await loadLabelPrintConfig()
          if (!cancelled) {
            const merged = mergeLabelConfig({ ...loaded, ...labelConfig })
            setLabelCfg(merged)
            setOpts((prev) => ({ ...prev, copies: merged.defaultCopies || 1 }))
            labelHydratedRef.current = true
          }
        }

        setStatusMsg(defaultPrinter ? 'Imprimante prête' : 'Aucune imprimante détectée')
        setStatusOk(!!defaultPrinter)
      } catch {
        if (cancelled) return
        setStatusMsg('Impossible de charger les imprimantes')
        setStatusOk(false)
      } finally {
        if (!cancelled) setPrintersLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [settingsKey, kind, labelConfig])

  useEffect(() => {
    if (kind !== 'label' || !labelHydratedRef.current) return
    setLabelSaveState('saving')
    scheduleSaveLabelPrintConfig(labelCfg, (ok) => {
      setLabelSaveState(ok ? 'saved' : 'idle')
      if (ok) {
        window.setTimeout(() => setLabelSaveState('idle'), 2000)
      }
    })
  }, [kind, labelCfg])

  // ── Derived page dimensions ────────────────────────────────────────────────

  const pageDims = useMemo(() => {
    if (kind === 'label') {
      return { w: labelCfg.widthMm, h: labelCfg.heightMm }
    }
    if (kind === 'ticket') {
      const base = PAGE_DIMS_MM[ticketWidthMm === 58 ? '58mm' : '80mm']
      return base
    }
    const base = PAGE_DIMS_MM.A4
    return opts.orientation === 'landscape'
      ? { w: base.h, h: base.w }
      : base
  }, [kind, labelCfg.widthMm, labelCfg.heightMm, ticketWidthMm, opts.orientation])

  const previewW = Math.round(mmToPx(pageDims.w) * (zoom / 100))
  const previewH = Math.round(mmToPx(pageDims.h) * (zoom / 100))
  const frameW = Math.round(mmToPx(pageDims.w))
  const frameH = Math.round(mmToPx(pageDims.h))
  const frameScale = zoom / 100

  // ── Iframe srcdoc ──────────────────────────────────────────────────────────

  const srcdoc = useMemo(() => {
    if (kind === 'label') {
      if (labelSource) {
        return buildBarcodeLabelHtml(
          labelSource.code,
          labelSource.nom,
          labelSource.prix,
          labelSource.productRef,
          labelCfg,
          opts.copies,
        )
      }
      return html
    }
    if (kind === 'document') {
      return wrapFragment(html, opts.margins, 'A4')
    }
    return html
  }, [kind, labelSource, labelCfg, html, opts.margins, opts.copies])

  // ── Option helpers ─────────────────────────────────────────────────────────

  const set = useCallback(<K extends keyof PrintOptions>(key: K, val: PrintOptions[K]) => {
    setOpts((prev) => ({ ...prev, [key]: val }))
  }, [])

  const setMargin = useCallback((side: keyof PrintOptions['margins'], val: number) => {
    setOpts((prev) => ({
      ...prev,
      margins: { ...prev.margins, [side]: Math.max(0, val) },
    }))
  }, [])

  const adjustCopies = useCallback((delta: number) => {
    setOpts((prev) => ({
      ...prev,
      copies: Math.min(99, Math.max(1, prev.copies + delta)),
    }))
  }, [])

  const patchLabelCfg = useCallback((patch: Partial<LabelPrintConfig>) => {
    setLabelCfg((prev) => mergeLabelConfig({ ...prev, ...patch }))
  }, [])

  useEffect(() => {
    if (kind !== 'label') return
    let cancelled = false
    async function loadGainscha() {
      try {
        const available = (await api.gainschaIsAvailable?.()) === true
        if (cancelled) return
        setGainschaAvailable(available)
        if (!available) return
        const ver = await api.gainschaVersion?.()
        if (!cancelled && ver?.version) setGainschaSdkVer(String(ver.version))
        const det = await api.gainschaDetectUsb?.()
        if (!cancelled && det?.devices?.length) {
          setGainschaUsbDevices(det.devices)
          setLabelCfg((prev) => (prev.usbDevice ? prev : mergeLabelConfig({ ...prev, usbDevice: det.devices![0] })))
        }
      } catch {
        if (!cancelled) setGainschaAvailable(false)
      }
    }
    loadGainscha()
    return () => { cancelled = true }
  }, [kind])

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function adjustZoom(delta: number) {
    setZoom((z) => Math.min(150, Math.max(20, z + delta)))
  }

  function fitZoom() {
    const canvasW = 380
    const natural = mmToPx(pageDims.w)
    const fit = Math.floor((canvasW / natural) * 100)
    setZoom(Math.min(150, Math.max(20, fit)))
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  async function handlePrint() {
    const useTsplRaw = kind === 'label' && labelCfg.labelEngine === 'tspl_raw'
    const useGainscha = kind === 'label'
      && labelCfg.labelEngine === 'gainscha'
      && gainschaAvailable
    const useUsb = useGainscha && labelCfg.labelConnection === 'usb'

    if (useUsb) {
      if (!labelCfg.usbDevice) {
        setStatusMsg('Sélectionnez un périphérique USB Gainscha')
        setStatusOk(false)
        return
      }
    } else if (!opts.printerName && !useTsplRaw) {
      setStatusMsg('Sélectionnez une imprimante')
      setStatusOk(false)
      return
    }

    setPrinting(true)
    setStatusMsg('Envoi vers l\'imprimante…')
    setStatusOk(true)

    try {
      if (settingsKey && !useUsb) {
        try {
          await api.settingsSet(settingsKey, opts.printerName)
        } catch {
          // non-fatal
        }
      }

      if (useTsplRaw) {
        await saveLabelPrintConfig(labelCfg)
        const source = labelSource ?? {
          code: '12345670',
          nom: 'Produit test scanner',
          prix: 12.5,
          productRef: 'REF-TEST',
        }
        if (!api.printTsplLabel) {
          setStatusMsg('TSPL raw indisponible')
          setStatusOk(false)
          return
        }
        const result = await api.printTsplLabel({
          codeBarre: source.code,
          nomProduit: source.nom || source.productRef || 'Produit',
          prix: `${Number(source.prix).toFixed(3)} DT`,
          copies: opts.copies,
          printerName: opts.printerName || undefined,
          widthMm: labelCfg.widthMm,
          heightMm: labelCfg.heightMm,
          rotationDeg: labelCfg.rotationDeg,
        })
        if (result.success) {
          setStatusMsg(`Imprimé (TSPL raw${result.printer ? ` · ${result.printer}` : ''}) · ${opts.copies} copie(s)`)
          setStatusOk(true)
        } else {
          setStatusMsg(`Erreur TSPL : ${result.error ?? 'inconnue'} — essayez SDK Gainscha ou HTML`)
          setStatusOk(false)
        }
        return
      }

      if (useGainscha) {
        await saveLabelPrintConfig(labelCfg)
        const source = labelSource ?? {
          code: '12345670',
          nom: 'Produit test scanner',
          prix: 12.5,
          productRef: 'REF-TEST',
        }
        const job = buildGainschaPrintJob(labelCfg, source, {
          printerName: opts.printerName,
          copies: opts.copies,
          connection: labelCfg.labelConnection,
          usbDevice: labelCfg.usbDevice,
        })
        if (!api.gainschaPrintLabel) {
          setStatusMsg('SDK Gainscha indisponible')
          setStatusOk(false)
          return
        }
        const result = await api.gainschaPrintLabel(job)
        if (result.success) {
          setStatusMsg(`Imprimé (SDK Gainscha) · ${opts.copies} copie(s)`)
          setStatusOk(true)
        } else {
          setStatusMsg(`Erreur Gainscha : ${result.error ?? 'inconnue'}`)
          setStatusOk(false)
        }
        return
      }

      let printOptions: Record<string, unknown> = {
        silent: true,
        printBackground: opts.printBackground,
        color: opts.color,
        copies: opts.copies,
      }

      if (kind === 'label') {
        await saveLabelPrintConfig(labelCfg)
        printOptions = {
          ...printOptions,
          widthMm: labelCfg.widthMm,
          heightMm: labelCfg.heightMm,
          dpi: { horizontal: labelCfg.dpi, vertical: labelCfg.dpi },
        }
      } else if (kind === 'document') {
        printOptions = {
          ...printOptions,
          pageSize: 'A4',
          margins: opts.margins,
          scaleFactor: opts.scale,
        }
      } else {
        printOptions = {
          ...printOptions,
          pageSize: ticketWidthMm === 58 ? '58mm' : '80mm',
        }
      }

      if (!api.printContent) {
        setStatusMsg('Impression indisponible')
        setStatusOk(false)
        return
      }

      const result = (await api.printContent(
        srcdoc,
        opts.printerName,
        printOptions,
      )) as { success: boolean; error?: string }

      if (result.success) {
        setStatusMsg(`Imprimé · ${opts.copies} copie(s)`)
        setStatusOk(true)
      } else {
        setStatusMsg(`Erreur : ${result.error ?? 'inconnue'}`)
        setStatusOk(false)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch'
      setStatusMsg(`Erreur : ${msg}`)
      setStatusOk(false)
    } finally {
      setPrinting(false)
    }
  }

  // ── Status bar chip ────────────────────────────────────────────────────────

  const sizeChip = useMemo(() => {
    if (kind === 'label') {
      return `${labelCfg.widthMm}×${labelCfg.heightMm} mm`
    }
    if (kind === 'ticket') {
      return `${ticketWidthMm} mm`
    }
    return `A4 · ${opts.orientation === 'portrait' ? '↕' : '↔'}`
  }, [kind, labelCfg.widthMm, labelCfg.heightMm, ticketWidthMm, opts.orientation])

  // ── Sidebar renderers ──────────────────────────────────────────────────────

  function renderPrinterSelect() {
    return (
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Imprimante</div>
        {printersLoading ? (
          <div style={styles.loadingText}>Chargement…</div>
        ) : (
          <select
            value={opts.printerName}
            onChange={(e) => {
              set('printerName', e.target.value)
              setStatusMsg(e.target.value ? 'Imprimante prête' : 'Aucune imprimante')
              setStatusOk(!!e.target.value)
            }}
            style={styles.select}
          >
            {printers.length === 0 && (
              <option value="">Aucune imprimante détectée</option>
            )}
            {printers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>
    )
  }

  function renderCopiesControl() {
    return (
      <div style={{ ...styles.field, marginTop: 10 }}>
        <label style={styles.fieldLabel}>Copies</label>
        <div style={styles.copiesRow}>
          <IconBtn onClick={() => adjustCopies(-1)}>−</IconBtn>
          <input
            type="number"
            value={opts.copies}
            min={1}
            max={99}
            onChange={(e) => set('copies', Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))}
            style={styles.copiesInput}
          />
          <IconBtn onClick={() => adjustCopies(1)}>+</IconBtn>
        </div>
      </div>
    )
  }

  function renderDocumentSidebar() {
    return (
      <>
        <div style={styles.tabRow}>
          {(['general', 'advanced'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                ...styles.tab,
                ...(tab === t ? styles.tabActive : {}),
              }}
            >
              {t === 'general' ? 'Général' : 'Avancé'}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            {renderPrinterSelect()}

            <div style={styles.section}>
              <div style={styles.sectionLabel}>Page</div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>Format</label>
                <div style={{ ...styles.select, background: 'var(--color-background-secondary, #f0f0f0)', color: 'var(--color-text-secondary, #666)' }}>
                  A4 — 210 × 297 mm
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>Orientation</label>
                <select
                  value={opts.orientation}
                  onChange={(e) => set('orientation', e.target.value as Orientation)}
                  style={styles.select}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Paysage</option>
                </select>
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionLabel}>Options</div>
              <Toggle id="opt-color" label="Couleur" checked={opts.color} onChange={(v) => set('color', v)} />
              <Toggle id="opt-bg" label="Arrière-plan" checked={opts.printBackground} onChange={(v) => set('printBackground', v)} />
              {renderCopiesControl()}
            </div>
          </>
        )}

        {tab === 'advanced' && (
          <>
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Marges (mm)</div>
              <div style={styles.marginGrid}>
                {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                  <div key={side} style={styles.miniField}>
                    <label style={styles.miniLabel}>
                      {{ top: 'Haut', bottom: 'Bas', left: 'Gauche', right: 'Droite' }[side]}
                    </label>
                    <input
                      type="number"
                      value={opts.margins[side]}
                      min={0}
                      onChange={(e) => setMargin(side, parseInt(e.target.value) || 0)}
                      style={styles.miniInput}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionLabel}>Échelle (%)</div>
              <input
                type="number"
                value={opts.scale}
                min={10}
                max={200}
                onChange={(e) => set('scale', Math.min(200, Math.max(10, parseInt(e.target.value) || 100)))}
                style={{ ...styles.select, width: 80 }}
              />
            </div>
          </>
        )}
      </>
    )
  }

  function renderLabelSidebar() {
    return (
      <>
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Étiquette</div>
          {labelSaveState !== 'idle' && (
            <div style={{ fontSize: 10, fontWeight: 600, color: labelSaveState === 'saved' ? '#3B6D11' : '#888', marginBottom: 6 }}>
              {labelSaveState === 'saving' ? 'Enregistrement…' : 'Layout enregistré'}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)', marginBottom: 8 }}>
            Éditeur visuel à droite — glisser / redimensionner les blocs (Code128)
          </div>
          <div style={styles.field}>
            <label style={styles.fieldLabel}>Moteur d&apos;impression</label>
            <select
              value={labelCfg.labelEngine}
              onChange={(e) => {
                const v = e.target.value
                patchLabelCfg({
                  labelEngine: v === 'html' ? 'html' : v === 'tspl_raw' ? 'tspl_raw' : 'gainscha',
                })
              }}
              style={styles.select}
            >
              <option value="tspl_raw">TSPL raw (COPY /B) — recommandé</option>
              {gainschaAvailable && (
                <option value="gainscha">SDK Gainscha (TSPL){gainschaSdkVer ? ` v${gainschaSdkVer}` : ''}</option>
              )}
              <option value="html">Windows / HTML (Seagull, 203 DPI)</option>
            </select>
          </div>
          {gainschaAvailable && labelCfg.labelEngine === 'gainscha' && (
            <>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>Connexion</label>
                <select
                  value={labelCfg.labelConnection}
                  onChange={(e) => patchLabelCfg({ labelConnection: e.target.value === 'usb' ? 'usb' : 'driver' })}
                  style={styles.select}
                >
                  <option value="driver">Imprimante Windows</option>
                  <option value="usb">USB direct (SDK)</option>
                </select>
              </div>
              {labelCfg.labelConnection === 'usb' && (
                <div style={styles.field}>
                  <label style={styles.fieldLabel}>Périphérique USB</label>
                  <select
                    value={labelCfg.usbDevice}
                    onChange={(e) => patchLabelCfg({ usbDevice: e.target.value })}
                    style={styles.select}
                  >
                    <option value="">— Choisir —</option>
                    {gainschaUsbDevices.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={{ ...styles.iconBtn, marginTop: 6, width: '100%', fontSize: 10 }}
                    onClick={async () => {
                      const det = await api.gainschaDetectUsb?.()
                      if (det?.devices) setGainschaUsbDevices(det.devices)
                    }}
                  >
                    Détecter USB
                  </button>
                </div>
              )}
            </>
          )}
          <div style={styles.field}>
            <label style={styles.fieldLabel}>Rotation</label>
            <select
              value={String(labelCfg.rotationDeg)}
              onChange={(e) => patchLabelCfg({ rotationDeg: parseInt(e.target.value, 10) === 180 ? 180 : 0 })}
              style={styles.select}
            >
              <option value="0">0° (normal)</option>
              <option value="180">180° (retourné)</option>
            </select>
          </div>
        </div>

        {labelCfg.labelConnection !== 'usb' && renderPrinterSelect()}
        {renderCopiesControl()}

        <div style={styles.section}>
          <Toggle id="label-color" label="Couleur" checked={opts.color} onChange={(v) => set('color', v)} />
          <Toggle id="label-bg" label="Arrière-plan" checked={opts.printBackground} onChange={(v) => set('printBackground', v)} />
        </div>
      </>
    )
  }

  function renderTicketSidebar() {
    return (
      <>
        {renderPrinterSelect()}

        <div style={styles.section}>
          <div style={styles.sectionLabel}>Ticket</div>
          <div style={styles.field}>
            <label style={styles.fieldLabel}>Largeur</label>
            <select
              value={String(ticketWidthMm)}
              onChange={(e) => setTicketWidthMm(parseInt(e.target.value, 10) === 58 ? 58 : 80)}
              style={styles.select}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
          </div>
          {renderCopiesControl()}
        </div>
      </>
    )
  }

  const canPrint = useMemo(() => {
    if (kind === 'label' && labelCfg.labelEngine === 'gainscha' && gainschaAvailable && labelCfg.labelConnection === 'usb') {
      return !!labelCfg.usbDevice
    }
    return !!opts.printerName
  }, [kind, labelCfg.labelEngine, labelCfg.labelConnection, labelCfg.usbDevice, gainschaAvailable, opts.printerName])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Gestionnaire d'impression">
      <div style={styles.modal}>

        {/* ── Header ── */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ marginRight: 8, verticalAlign: -2 }}>
              <path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="10" rx="1"/><path d="M6 14h12M6 18h8"/>
            </svg>
            {MODE_HEADERS[kind]}
          </span>
          <button type="button" onClick={onClose} style={styles.closeBtn} aria-label="Fermer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>

          {/* ── Sidebar ── */}
          <div style={styles.sidebar}>
            {kind === 'document' && renderDocumentSidebar()}
            {kind === 'label' && renderLabelSidebar()}
            {kind === 'ticket' && renderTicketSidebar()}

            {/* Print button */}
            <div style={styles.printBtnRow}>
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing || !canPrint}
                style={{
                  ...styles.printBtn,
                  opacity: printing || !canPrint ? 0.5 : 1,
                  cursor: printing || !canPrint ? 'not-allowed' : 'pointer',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                  <path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="10" rx="1"/><path d="M6 14h12M6 18h8"/>
                </svg>
                {printing ? 'Impression…' : 'Imprimer'}
              </button>
            </div>
          </div>

          {/* ── Preview pane ── */}
          <div style={styles.previewPane}>

            {/* Toolbar */}
            <div style={styles.previewToolbar}>
              <div style={styles.pageNav}>
                <IconBtn onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>‹</IconBtn>
                <span style={styles.pageIndicator}>Page {currentPage} / {totalPages}</span>
                <IconBtn onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>›</IconBtn>
              </div>
              <div style={styles.zoomGroup}>
                <IconBtn onClick={() => adjustZoom(-10)}>−</IconBtn>
                <span style={styles.zoomLabel}>{zoom}%</span>
                <IconBtn onClick={() => adjustZoom(10)}>+</IconBtn>
                <IconBtn onClick={fitZoom} title="Ajuster à la largeur">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                  </svg>
                </IconBtn>
              </div>
            </div>

            {/* Canvas */}
            <div style={styles.canvas}>
              {kind === 'label' && labelSource ? (
                <div style={{ width: '100%', height: '100%', padding: 8, boxSizing: 'border-box' }}>
                  <LabelVisualEditor
                    config={labelCfg}
                    preview={{
                      code: labelSource.code,
                      nom: labelSource.nom,
                      prix: labelSource.prix,
                      productRef: labelSource.productRef,
                    }}
                    onConfigChange={patchLabelCfg}
                    zoomPct={zoom}
                  />
                </div>
              ) : (
              <div
                style={{
                  ...styles.pageShadow,
                  width: previewW,
                  height: previewH,
                  minHeight: 40,
                }}
              >
                <div
                  style={{
                    width: frameW,
                    height: frameH,
                    transform: `scale(${frameScale})`,
                    transformOrigin: 'top left',
                    overflow: 'hidden',
                  }}
                >
                  <iframe
                    ref={frameRef}
                    title="Aperçu avant impression"
                    srcDoc={srcdoc}
                    sandbox="allow-same-origin"
                    style={{
                      width: frameW,
                      height: frameH,
                      border: 'none',
                      display: 'block',
                      background: 'white',
                    }}
                  />
                </div>
              </div>
              )}
            </div>

            {/* Status bar */}
            <div style={styles.statusBar}>
              <span
                style={{
                  ...styles.statusDot,
                  background: statusOk ? '#639922' : '#E24B4A',
                }}
              />
              <span style={styles.statusText}>{statusMsg}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={styles.chip}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
                    <path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="10" rx="1"/>
                  </svg>
                  {opts.printerName
                    ? opts.printerName.split(' ').slice(0, 2).join(' ')
                    : '—'}
                </span>
                <span style={styles.chip}>{sizeChip}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: 'var(--color-background-primary, #fff)',
    borderRadius: 12,
    border: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
    width: 860,
    maxWidth: '96vw',
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--color-text-primary, #111)',
    display: 'flex',
    alignItems: 'center',
  },
  closeBtn: {
    width: 28,
    height: 28,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 8,
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-secondary, #666)',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    borderRight: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    background: 'var(--color-background-secondary, #f8f8f8)',
  },
  tabRow: {
    display: 'flex',
    borderBottom: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    fontSize: 12,
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--color-text-secondary, #666)',
    fontWeight: 400,
  },
  tabActive: {
    color: 'var(--color-text-primary, #111)',
    borderBottomColor: '#3B6D11',
    fontWeight: 500,
  },
  section: {
    padding: '12px 14px',
    borderBottom: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'var(--color-text-tertiary, #999)',
    marginBottom: 8,
  },
  field: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    color: 'var(--color-text-secondary, #666)',
    display: 'block',
    marginBottom: 4,
  },
  select: {
    width: '100%',
    padding: '5px 7px',
    fontSize: 12,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 8,
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #111)',
    outline: 'none',
  },
  loadingText: {
    fontSize: 12,
    color: 'var(--color-text-tertiary, #999)',
    fontStyle: 'italic',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  toggleLabel: {
    fontSize: 12,
    color: 'var(--color-text-secondary, #666)',
    cursor: 'pointer',
  },
  toggleTrack: {
    position: 'relative' as const,
    width: 32,
    height: 18,
    borderRadius: 9,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.2s',
    flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute' as const,
    top: 2,
    left: 2,
    width: 14,
    height: 14,
    background: 'white',
    borderRadius: '50%',
    transition: 'transform 0.2s',
    display: 'block',
    pointerEvents: 'none' as const,
  },
  copiesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  copiesInput: {
    width: 52,
    padding: '4px 6px',
    fontSize: 12,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 8,
    textAlign: 'center' as const,
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #111)',
    outline: 'none',
  },
  marginGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  miniField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  miniLabel: {
    fontSize: 10,
    color: 'var(--color-text-tertiary, #999)',
  },
  miniInput: {
    width: '100%',
    padding: '3px 5px',
    fontSize: 12,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 6,
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #111)',
    outline: 'none',
  },
  profileBtn: {
    width: '100%',
    padding: '6px 10px',
    fontSize: 12,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 8,
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #111)',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  printBtnRow: {
    padding: '12px 14px',
    marginTop: 'auto',
  },
  printBtn: {
    width: '100%',
    padding: '9px 0',
    fontSize: 13,
    fontWeight: 500,
    background: '#3B6D11',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  iconBtn: {
    width: 26,
    height: 26,
    border: '0.5px solid var(--color-border-secondary, #ccc)',
    borderRadius: 8,
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: 'var(--color-text-secondary, #666)',
    flexShrink: 0,
  },
  previewPane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--color-background-tertiary, #f0f0f0)',
    minWidth: 0,
    overflow: 'hidden',
  },
  previewToolbar: {
    padding: '7px 14px',
    borderBottom: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--color-background-primary, #fff)',
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pageIndicator: {
    fontSize: 12,
    color: 'var(--color-text-secondary, #666)',
    minWidth: 70,
    textAlign: 'center' as const,
  },
  zoomGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  zoomLabel: {
    fontSize: 12,
    color: 'var(--color-text-secondary, #666)',
    minWidth: 36,
    textAlign: 'center' as const,
  },
  canvas: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 24,
  },
  pageShadow: {
    background: 'white',
    boxShadow: '0 2px 16px rgba(0,0,0,0.13)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  statusBar: {
    padding: '5px 14px',
    fontSize: 11,
    color: 'var(--color-text-tertiary, #999)',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    borderTop: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
    background: 'var(--color-background-primary, #fff)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.3s',
  },
  statusText: {
    color: 'var(--color-text-secondary, #666)',
    fontSize: 11,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 7px',
    background: 'var(--color-background-secondary, #f5f5f5)',
    border: '0.5px solid var(--color-border-tertiary, #e5e5e5)',
    borderRadius: 20,
    fontSize: 10,
    color: 'var(--color-text-secondary, #666)',
  },
}
