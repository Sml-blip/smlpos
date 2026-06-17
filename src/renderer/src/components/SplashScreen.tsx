import { useEffect, useState } from 'react'
import splashGif from '../assets/splash.gif'

interface Props {
  onDone: () => void
}

// Total visible time before fade-out starts (ms)
const VISIBLE_MS = 2600
// Fade-out duration (ms) — must match the CSS transition
const FADE_MS = 400

export default function SplashScreen({ onDone }: Props) {
  const [progress, setProgress] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    // Start progress bar fill right after mount
    const t1 = setTimeout(() => setProgress(100), 60)

    // Begin fade-out
    const t2 = setTimeout(() => setFading(true), VISIBLE_MS)

    // Call onDone after fade completes
    const t3 = setTimeout(() => onDone(), VISIBLE_MS + FADE_MS)

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 10, 10, 0.72)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: fading ? 'none' : 'all',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        {/* GIF */}
        <img
          src={splashGif}
          alt="SMLPOS loading"
          style={{
            width: 220,
            height: 220,
            objectFit: 'contain',
            borderRadius: 24,
          }}
        />

        {/* Loading bar track */}
        <div style={{
          width: 220,
          height: 5,
          borderRadius: 99,
          background: 'rgba(255,255,255,0.15)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            borderRadius: 99,
            background: '#FFD600',
            width: `${progress}%`,
            transition: `width ${VISIBLE_MS - 100}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }} />
        </div>

        {/* Label */}
        <span style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: 11,
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          Chargement…
        </span>
      </div>
    </div>
  )
}
