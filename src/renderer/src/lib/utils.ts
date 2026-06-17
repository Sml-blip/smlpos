import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '0.000 DT'
  return amount.toFixed(3) + ' DT'
}

export function formatDate(dateStr: string, fmt = 'dd/MM/yyyy HH:mm'): string {
  try {
    return format(new Date(dateStr), fmt, { locale: fr })
  } catch {
    return dateStr
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function generateReference(): string {
  const now = new Date()
  const dateStr = format(now, 'yyMMdd')
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0')
  return `PRD-${dateStr}-${rand}`
}

export function generateVenteNumber(lastNum: number): string {
  const dateStr = format(new Date(), 'yyyyMMdd')
  return `VTE-${dateStr}-${String(lastNum + 1).padStart(4, '0')}`
}

export function generateReparationNumber(lastNum: number): string {
  const dateStr = format(new Date(), 'yyyyMMdd')
  return `REP-${dateStr}-${String(lastNum + 1).padStart(3, '0')}`
}

export function smartSearch<T extends Record<string, unknown>>(
  query: string,
  items: T[],
  fields: (keyof T)[]
): T[] {
  const q = query.toLowerCase().trim()
  if (!q) return items
  return items.filter(item =>
    fields.some(field => String(item[field] ?? '').toLowerCase().includes(q))
  )
}
