export interface CreditInstallmentPlan {
  total: number
  months: number
  firstPaymentDate: string
  monthlyAmount: number
}

export interface CreditInstallmentDue {
  number: number
  date: string
  amount: number
}

export const INSTALLMENT_NOTE_PREFIX = '[SMLPOS_INSTALLMENT]'

export function money3(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}

export function addMonthsIso(date: string, months: number) {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  const day = parsed.getDate()
  parsed.setDate(1)
  parsed.setMonth(parsed.getMonth() + months)
  const lastDay = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate()
  parsed.setDate(Math.min(day, lastDay))
  return parsed.toISOString().slice(0, 10)
}

export function upcomingInstallments(plan: CreditInstallmentPlan): CreditInstallmentDue[] {
  const months = Math.max(1, Math.min(60, Math.floor(plan.months || 1)))
  const total = money3(plan.total)
  const regular = money3(total / months)
  return Array.from({ length: months }, (_, index) => ({
    number: index + 1,
    date: addMonthsIso(plan.firstPaymentDate, index),
    amount: index === months - 1 ? money3(total - regular * (months - 1)) : regular,
  }))
}

export function installmentNote(note: string, plan: CreditInstallmentPlan) {
  return [note.trim(), `${INSTALLMENT_NOTE_PREFIX}${JSON.stringify(plan)}`].filter(Boolean).join('\n')
}

export function parseInstallmentPlan(note?: string | null): CreditInstallmentPlan | null {
  const match = String(note ?? '').match(/\[SMLPOS_INSTALLMENT\](\{[^\r\n]*\})/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1]) as Partial<CreditInstallmentPlan>
    const total = money3(Number(raw.total))
    const months = Math.max(1, Math.min(60, Math.floor(Number(raw.months))))
    const firstPaymentDate = String(raw.firstPaymentDate ?? '')
    if (!total || !firstPaymentDate || Number.isNaN(new Date(`${firstPaymentDate}T12:00:00`).getTime())) return null
    return { total, months, firstPaymentDate, monthlyAmount: money3(Number(raw.monthlyAmount) || total / months) }
  } catch {
    return null
  }
}

export function cleanCreditPlanNote(note?: string | null) {
  return String(note ?? '').replace(/\n?\[SMLPOS_INSTALLMENT\]\{[^\r\n]*\}/g, '').trim()
}
