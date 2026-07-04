import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { labelBarcodeSvg, pickBarcodeValue } from '../lib/barcode'
import type { LabelPrintConfig } from '../lib/printManager'
import {
  BARCODE_FORMAT_OPTIONS,
  clampBox,
  clampLayout,
  fontPtForBox,
  LABEL_ELEMENT_IDS,
  printableArea,
  resetVisualLayout,
  type LabelElementId,
  type LabelVisualLayout,
} from '../lib/labelLayout'
import { parseLabelPrice } from '../lib/barcodeLabel'

const MM_TO_PX = 3.7795275591

export interface LabelPreviewData {
  code: string
  nom: string
  prix: number
  productRef?: string
}

interface LabelVisualEditorProps {
  config: LabelPrintConfig
  preview: LabelPreviewData
  onConfigChange: (patch: Partial<LabelPrintConfig>) => void
  zoomPct?: number
}

type DragMode = 'move' | 'resize'

interface DragState {
  id: LabelElementId
  mode: DragMode
  startX: number
  startY: number
  orig: LabelVisualLayout[LabelElementId]
}

export default function LabelVisualEditor({
  config,
  preview,
  onConfigChange,
  zoomPct = 100,
}: LabelVisualEditorProps) {
  const { contentW, contentH } = printableArea(config)
  const layout = useMemo(
    () => clampLayout(config.layout, contentW, contentH),
    [config.layout, contentW, contentH],
  )

  const [selected, setSelected] = useState<LabelElementId>('barcode')
  const dragRef = useRef<DragState | null>(null)

  const scale = zoomPct / 100
  const areaW = contentW * MM_TO_PX * scale
  const areaH = contentH * MM_TO_PX * scale

  const priceStr = `${parseLabelPrice(preview.prix).toFixed(3)} DT`
  const displayName = (preview.nom || preview.productRef || 'Produit').trim()
  const barcodeValue = pickBarcodeValue(preview.code, preview.productRef)

  const barcodeSvg = useMemo(
    () => labelBarcodeSvg(barcodeValue, {
      maxWidthMm: layout.barcode.w,
      barHeightMm: Math.max(3, layout.barcode.h - (layout.showBarcodeText ? 3 : 0)),
      showText: layout.showBarcodeText,
      formatMode: layout.barcodeFormat,
    }),
    [barcodeValue, layout.barcode.w, layout.barcode.h, layout.showBarcodeText, layout.barcodeFormat],
  )

  const patchLayout = useCallback((next: LabelVisualLayout) => {
    onConfigChange({ layout: clampLayout(next, contentW, contentH) })
  }, [contentW, contentH, onConfigChange])

  const [liveLayout, setLiveLayout] = useState<LabelVisualLayout | null>(null)
  const liveLayoutRef = useRef<LabelVisualLayout | null>(null)
  const displayLayout = liveLayout ?? layout

  const pxToMm = useCallback((px: number) => px / (MM_TO_PX * scale), [scale])

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = pxToMm(e.clientX - drag.startX)
    const dy = pxToMm(e.clientY - drag.startY)
    const next = { ...layout }
    if (drag.mode === 'move') {
      next[drag.id] = clampBox({
        ...drag.orig,
        x: drag.orig.x + dx,
        y: drag.orig.y + dy,
      }, contentW, contentH)
    } else {
      next[drag.id] = clampBox({
        ...drag.orig,
        w: drag.orig.w + dx,
        h: drag.orig.h + dy,
      }, contentW, contentH)
    }
    const clamped = clampLayout(next, contentW, contentH)
    liveLayoutRef.current = clamped
    setLiveLayout(clamped)
  }, [contentW, contentH, layout, pxToMm])

  const onPointerUp = useCallback(() => {
    if (liveLayoutRef.current) {
      patchLayout(liveLayoutRef.current)
    }
    liveLayoutRef.current = null
    setLiveLayout(null)
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, patchLayout])

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, onPointerUp])

  function startDrag(id: LabelElementId, mode: DragMode, e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSelected(id)
    dragRef.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...displayLayout[id] },
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function toggleVisible(id: LabelElementId) {
    patchLayout({
      ...displayLayout,
      [id]: { ...displayLayout[id], visible: !displayLayout[id].visible },
    })
  }

  function renderElement(id: LabelElementId) {
    const box = displayLayout[id]
    if (!box.visible) return null
    const isSel = selected === id
    const left = box.x * MM_TO_PX * scale
    const top = box.y * MM_TO_PX * scale
    const w = box.w * MM_TO_PX * scale
    const h = box.h * MM_TO_PX * scale

    let content: React.ReactNode = null
    if (id === 'name') {
      content = (
        <span style={{ fontSize: `${fontPtForBox(box.h, 8) * scale}pt`, fontWeight: 700, lineHeight: 1.05 }}>
          {displayName}
        </span>
      )
    } else if (id === 'price') {
      content = (
        <span style={{ fontSize: `${fontPtForBox(box.h, 10) * scale}pt`, fontWeight: 900 }}>
          {priceStr}
        </span>
      )
    } else {
      content = (
        <div
          style={{ width: '100%', height: '100%' }}
          dangerouslySetInnerHTML={{ __html: barcodeSvg }}
        />
      )
    }

    const labels: Record<LabelElementId, string> = {
      name: 'Nom',
      barcode: 'Code-barres',
      price: 'Prix',
    }

    return (
      <div
        key={id}
        role="button"
        tabIndex={0}
        onPointerDown={(e) => startDrag(id, 'move', e)}
        onClick={(e) => { e.stopPropagation(); setSelected(id) }}
        style={{
          position: 'absolute',
          left,
          top,
          width: w,
          height: h,
          border: isSel ? '1.5px solid #3B6D11' : '1px dashed rgba(100,100,100,0.45)',
          background: isSel ? 'rgba(59,109,17,0.06)' : 'rgba(255,255,255,0.6)',
          cursor: 'move',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          boxSizing: 'border-box',
          touchAction: 'none',
        }}
      >
        {isSel && (
          <span style={{
            position: 'absolute',
            top: -16,
            left: 0,
            fontSize: 9,
            fontWeight: 700,
            color: '#3B6D11',
            background: '#fff',
            padding: '0 3px',
            borderRadius: 2,
          }}>
            {labels[id]}
          </span>
        )}
        <div style={{ width: '100%', padding: '0 1px', pointerEvents: 'none' }}>{content}</div>
        {isSel && (
          <div
            onPointerDown={(e) => startDrag(id, 'resize', e)}
            style={{
              position: 'absolute',
              right: -4,
              bottom: -4,
              width: 10,
              height: 10,
              background: '#3B6D11',
              borderRadius: 2,
              cursor: 'nwse-resize',
              touchAction: 'none',
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>
        Cliquez pour sélectionner · glissez pour déplacer · coin vert pour redimensionner
      </div>

      <div
        onClick={() => setSelected('barcode')}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 120,
          background: 'repeating-conic-gradient(#f0f0f0 0% 25%, #fafafa 0% 50%) 50% / 16px 16px',
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div
          style={{
            width: areaW,
            height: areaH,
            background: '#fff',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            position: 'relative',
            transform: config.rotationDeg === 180 ? 'rotate(180deg)' : undefined,
          }}
        >
          {LABEL_ELEMENT_IDS.map(renderElement)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Format code-barres</span>
          <select
            value={displayLayout.barcodeFormat}
            className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
            onChange={(e) => patchLayout({ ...displayLayout, barcodeFormat: e.target.value as LabelVisualLayout['barcodeFormat'] })}
          >
            {BARCODE_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
          <input
            type="checkbox"
            checked={displayLayout.showBarcodeText}
            onChange={(e) => patchLayout({ ...displayLayout, showBarcodeText: e.target.checked })}
          />
          Numéro sous le code
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {LABEL_ELEMENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggleVisible(id)}
            style={{
              padding: '4px 8px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid #ddd',
              background: displayLayout[id].visible ? '#e8f5e0' : '#f5f5f5',
              cursor: 'pointer',
            }}
          >
            {id === 'name' ? 'Nom' : id === 'barcode' ? 'Code' : 'Prix'}
            {displayLayout[id].visible ? ' ✓' : ' ✗'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onConfigChange({ layout: resetVisualLayout(config) })}
          style={{
            padding: '4px 8px',
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  )
}
