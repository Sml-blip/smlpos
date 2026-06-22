/**
 * PrintManagerModal.tsx
 *
 * Full-featured in-app print manager for Electron + Supabase POS.
 * - Live iframe preview with zoom / page navigation
 * - Printer picker loaded from Electron via api.getPrinters()
 * - Page format, orientation, margins, copies, color, background, silent
 * - Saved profiles per settingsKey (facture A4, ticket 58mm, étiquette)
 * - Robust error surface in status bar
 *
 * Usage:
 *   <PrintManagerModal
 *     html={myHtml}
 *     defaultPageSize="A4"
 *     settingsKey="impression_printer_a4"
 *     onClose={() => setOpen(false)}
 *   />
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'

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
  /** Full HTML document string (<!DOCTYPE …>) or inner HTML fragment */
  html: string
  /** Preset page size shown on open */
  defaultPageSize?: NativePageSize
  /**
   * Settings key used to persist / restore the last-used printer.
   * e.g. 'impression_printer_a4' | 'impression_printer_ticket'
   */
  settingsKey?: string
  /** Called when the user closes the modal */
  onClose: () => void
  /** Optional extra profiles injected by the caller */
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

const DEFAULT_PROFILES: PrintProfile[] = [
  {
    label: 'Facture A4',
    options: {
      pageSize: 'A4',
      orientation: 'portrait',
      color: true,
      printBackground: true,
      silent: false,
      copies: 1,
      margins: { top: 8, bottom: 8, left: 8, right: 8 },
      scale: 100,
    },
  },
  {
    label: 'Ticket 58 mm',
    options: {
      pageSize: '58mm',
      orientation: 'portrait',
      color: false,
      printBackground: true,
      silent: true,
      copies: 1,
      margins: { top: 2, bottom: 2, left: 2, right: 2 },
      scale: 100,
    },
  },
  {
    label: 'Étiquette 40×20',
    options: {
      pageSize: '40x20mm',
      orientation: 'landscape',
      color: true,
      printBackground: true,
      silent: true,
      copies: 1,
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
      scale: 100,
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

function wrapFragment(html: string, margins: PrintOptions['margins'], pageSize: NativePageSize): string {
  if (html.trimStart().startsWith('<!DOCTYPE') || html.trimStart().startsWith('<html')) {
    return html
  }
  const isSmall = pageSize !== 'A4' && pageSize !== 'A5'
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
    font-size: ${isSmall ? '9px' : '12px'};
  }
  @page {
    size: ${pageSize === 'A4' || pageSize === 'A5' ? pageSize : pageSize + ' auto'};
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
    <button onClick={onClick} title={title} style={{ ...styles.iconBtn, ...style }}>
      {children}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PrintManagerModal({
  html,
  defaultPageSize = 'A4',
  settingsKey,
  onClose,
  extraProfiles = [],
}: PrintManagerModalProps) {
  // ── State ──────────────────────────────────────────────────────────────────

  const [tab, setTab] = useState<'general' | 'advanced'>('general')
  const [printers, setPrinters] = useState<string[]>([])
  const [printersLoading, setPrintersLoading] = useState(true)

  const [opts, setOpts] = useState<PrintOptions>({
    printerName: '',
    pageSize: defaultPageSize,
    orientation: 'portrait',
    color: true,
    printBackground: true,
    silent: false,
    copies: 1,
    margins: { top: 8, bottom: 8, left: 8, right: 8 },
    scale: 100,
  })

  const [zoom, setZoom] = useState(75)
  const [printing, setPrinting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Prêt')
  const [statusOk, setStatusOk] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages] = useState(1) // extend with multi-page support as needed

  const frameRef = useRef<HTMLIFrameElement>(null)
  const allProfiles = useMemo(() => [...DEFAULT_PROFILES, ...extraProfiles], [extraProfiles])

  // ── Load printers + saved settings on mount ────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = (await api.getPrinters()) as { name: string }[]
        if (cancelled) return
        const names = list.map((p) => p.name).filter(Boolean)
        setPrinters(names)

        // Restore last-used printer from settings
        let savedPrinter = ''
        if (settingsKey) {
          try {
            const all = (await api.settingsGetAll()) as Record<string, string>
            savedPrinter = all?.[settingsKey] ?? ''
          } catch {
            // settings unavailable — non-fatal
          }
        }

        const defaultPrinter = savedPrinter && names.includes(savedPrinter)
          ? savedPrinter
          : names[0] ?? ''

        setOpts((prev) => ({ ...prev, printerName: defaultPrinter }))
        setStatusMsg(defaultPrinter ? 'Imprimante prête' : 'Aucune imprimante détectée')
        setStatusOk(!!defaultPrinter)
      } catch (err) {
        if (cancelled) return
        setStatusMsg('Impossible de charger les imprimantes')
        setStatusOk(false)
      } finally {
        if (!cancelled) setPrintersLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [settingsKey])

  // ── Derived page dimensions ────────────────────────────────────────────────

  const pageDims = useMemo(() => {
    const base = PAGE_DIMS_MM[opts.pageSize] ?? PAGE_DIMS_MM.A4
    return opts.orientation === 'landscape'
      ? { w: base.h, h: base.w }
      : base
  }, [opts.pageSize, opts.orientation])

  const previewW = Math.round(mmToPx(pageDims.w) * (zoom / 100))
  const previewH = Math.round(mmToPx(pageDims.h) * (zoom / 100))
  const frameW = Math.round(mmToPx(pageDims.w))
  const frameH = Math.round(mmToPx(pageDims.h))
  const frameScale = zoom / 100

  // ── Iframe srcdoc ──────────────────────────────────────────────────────────

  const srcdoc = useMemo(
    () => wrapFragment(html, opts.margins, opts.pageSize),
    [html, opts.margins, opts.pageSize],
  )

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

  function loadProfile(idx: number) {
    const p = allProfiles[idx]
    if (!p) return
    setOpts((prev) => ({ ...prev, ...p.options }))
    setStatusMsg(`Profil "${p.label}" chargé`)
    setStatusOk(true)
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function adjustZoom(delta: number) {
    setZoom((z) => Math.min(150, Math.max(20, z + delta)))
  }

  function fitZoom() {
    // Fit page width into ~380px canvas
    const canvasW = 380
    const natural = mmToPx(pageDims.w)
    const fit = Math.floor((canvasW / natural) * 100)
    setZoom(Math.min(150, Math.max(20, fit)))
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  async function handlePrint() {
    if (!opts.printerName) {
      setStatusMsg('Sélectionnez une imprimante')
      setStatusOk(false)
      return
    }

    setPrinting(true)
    setStatusMsg('Envoi vers l\'imprimante…')
    setStatusOk(true)

    try {
      // Persist chosen printer to settings
      if (settingsKey) {
        try {
          await api.settingsSet(settingsKey, opts.printerName)
        } catch {
          // non-fatal
        }
      }

      const result = (await api.printContent(
        srcdoc,
        opts.printerName,
        {
          silent: opts.silent,
          printBackground: opts.printBackground,
          color: opts.color,
          copies: opts.copies,
          pageSize: opts.pageSize,
          // Pass margins for @page rule in HTML — printWindow.ts handles this
          margins: opts.margins,
          scaleFactor: opts.scale,
        },
      )) as { success: boolean; error?: string }

      if (result.success) {
        setStatusMsg(`Imprimé · ${opts.copies} copie(s)`)
        setStatusOk(true)
      } else {
        setStatusMsg(`Erreur : ${result.error ?? 'inconnue'}`)
        setStatusOk(false)
      }
    } catch (err: any) {
      setStatusMsg(`Erreur : ${err?.message ?? 'Failed to fetch'}`)
      setStatusOk(false)
    } finally {
      setPrinting(false)
    }
  }

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
            Impression
          </span>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Fermer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>

          {/* ── Sidebar ── */}
          <div style={styles.sidebar}>

            {/* Tab row */}
            <div style={styles.tabRow}>
              {(['general', 'advanced'] as const).map((t) => (
                <button
                  key={t}
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

            {/* ── General tab ── */}
            {tab === 'general' && (
              <>
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

                <div style={styles.section}>
                  <div style={styles.sectionLabel}>Page</div>
                  <div style={styles.field}>
                    <label style={styles.fieldLabel}>Format</label>
                    <select
                      value={opts.pageSize}
                      onChange={(e) => set('pageSize', e.target.value as NativePageSize)}
                      style={styles.select}
                    >
                      <option value="A4">A4 — 210 × 297 mm</option>
                      <option value="A5">A5 — 148 × 210 mm</option>
                      <option value="58mm">Ticket 58 mm</option>
                      <option value="80mm">Ticket 80 mm</option>
                      <option value="40x20mm">Étiquette 40 × 20 mm</option>
                    </select>
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
                  <Toggle id="opt-silent" label="Mode silencieux" checked={opts.silent} onChange={(v) => set('silent', v)} />
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
                </div>
              </>
            )}

            {/* ── Advanced tab ── */}
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

                <div style={styles.section}>
                  <div style={styles.sectionLabel}>Profils enregistrés</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {allProfiles.map((p, i) => (
                      <button
                        key={p.label}
                        onClick={() => loadProfile(i)}
                        style={styles.profileBtn}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Print button */}
            <div style={styles.printBtnRow}>
              <button
                onClick={handlePrint}
                disabled={printing || !opts.printerName}
                style={{
                  ...styles.printBtn,
                  opacity: printing || !opts.printerName ? 0.5 : 1,
                  cursor: printing || !opts.printerName ? 'not-allowed' : 'pointer',
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
                <span style={styles.chip}>
                  {opts.pageSize} · {opts.orientation === 'portrait' ? '↕' : '↔'}
                </span>
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
