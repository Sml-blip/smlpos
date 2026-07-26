export type FeedbackSound = 'click' | 'startup' | 'cash' | 'invoice' | 'success'

let audioContext: AudioContext | null = null
let lastClickAt = 0

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return null
  if (!audioContext) audioContext = new AudioContextClass()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startsIn: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency = frequency,
) {
  const start = ctx.currentTime + startsIn
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration / 3))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

export function playFeedback(sound: FeedbackSound) {
  try {
    const ctx = context()
    if (!ctx) return
    if (sound === 'click') {
      tone(ctx, 620, 0, 0.035, 0.012, 'sine', 500)
      return
    }
    if (sound === 'startup') {
      tone(ctx, 392, 0, 0.16, 0.025)
      tone(ctx, 523.25, 0.09, 0.18, 0.026)
      tone(ctx, 659.25, 0.18, 0.25, 0.03)
      return
    }
    if (sound === 'cash') {
      tone(ctx, 880, 0, 0.08, 0.032, 'triangle', 1046.5)
      tone(ctx, 1318.5, 0.075, 0.13, 0.026, 'sine', 1568)
      tone(ctx, 2093, 0.17, 0.16, 0.018, 'sine', 1760)
      return
    }
    if (sound === 'invoice') {
      tone(ctx, 523.25, 0, 0.14, 0.025, 'triangle')
      tone(ctx, 659.25, 0.06, 0.17, 0.024, 'triangle')
      tone(ctx, 783.99, 0.13, 0.24, 0.027, 'sine')
      return
    }
    tone(ctx, 659.25, 0, 0.11, 0.02)
    tone(ctx, 880, 0.08, 0.18, 0.022)
  } catch {
    // Feedback must never interrupt a business action.
  }
}

export function installGlobalInteractionFeedback(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const interactive = target.closest('button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])')
    if (!interactive || interactive.hasAttribute('data-sound-off')) return
    const now = performance.now()
    if (now - lastClickAt < 35) return
    lastClickAt = now
    playFeedback('click')
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  return () => document.removeEventListener('pointerdown', onPointerDown, true)
}
