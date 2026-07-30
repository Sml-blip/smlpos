export type ParsedInvoiceLine = {
  id: string
  designation: string
  quantite: number
  prixUnitaire: number
  sourceLine: string
  confidence: 'high' | 'medium' | 'low'
}

export type ParsedInvoiceMetadata = {
  numeroFacture?: string
  dateFacture?: string
}

const SKIP_LINE = /\b(total|sous[\s-]?total|montant|net\s+[àa]\s+payer|tva|taxe|timbre|remise|facture|fournisseur|client|matricule|adresse|t[ée]l[ée]phone|page)\b/i
const NUMBER_TOKEN = /(?:^|\s)(x?\s*\d+(?:(?:\.\d{3})+|[,.]\d{1,3})?)(?=\s|$)/gi

function parseNumber(raw: string): number {
  let value = raw.toLowerCase().replace(/^x\s*/, '').replace(/\s/g, '')
  if (value.includes(',') && value.includes('.')) {
    if (value.lastIndexOf(',') > value.lastIndexOf('.')) {
      value = value.replace(/\./g, '').replace(',', '.')
    } else {
      value = value.replace(/,/g, '')
    }
  } else if (value.includes(',')) {
    value = value.replace(',', '.')
  } else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(value)) {
    const groups = value.split('.')
    value = `${groups.slice(0, -1).join('')}.${groups.at(-1)}`
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function cleanDesignation(line: string, tokens: Array<{ raw: string; index: number }>): string {
  let designation = line
  for (const token of [...tokens].sort((a, b) => b.index - a.index)) {
    designation = `${designation.slice(0, token.index)} ${designation.slice(token.index + token.raw.length)}`
  }
  return designation
    .replace(/[|¦]+/g, ' ')
    .replace(/^[\s;:.,#\-–—]+|[\s;:.,#\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isPlausibleDesignation(value: string): boolean {
  return value.length >= 3 && /[A-Za-zÀ-ÿ\u0600-\u06ff]/.test(value)
}

export function parseInvoiceLines(text: string): ParsedInvoiceLine[] {
  const parsed: ParsedInvoiceLine[] = []
  const allLines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line
      .replace(/\t/g, ' ')
      .replace(/(?<=\d)[\]|;](?=\s|$)/g, ' ')
      .replace(/(?<=\s)[|;](?=\d)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean)
  const tableHeaderIndex = allLines.findIndex(line =>
    /\bDESIGNATION\b/i.test(line) && /\b(?:QTE|QTY|QUANTITE)\b/i.test(line),
  )
  const afterHeader = tableHeaderIndex >= 0 ? allLines.slice(tableHeaderIndex + 1) : allLines
  const tableEndIndex = afterHeader.findIndex(line =>
    /\b(?:MONTANT\s+H[\s.]?T|BASE\s+TVA|TOTAL\s+T[\s.]?V[\s.]?A|NET\s+A\s+PAYER)\b/i.test(line),
  )
  const normalizedLines = tableEndIndex >= 0 ? afterHeader.slice(0, tableEndIndex) : afterHeader

  normalizedLines.forEach((sourceLine, lineIndex) => {
    if (SKIP_LINE.test(sourceLine) || /\bBL\s*n[°oº]/i.test(sourceLine)) return
    const tokens: Array<{ raw: string; value: number; index: number }> = []
    for (const match of sourceLine.matchAll(NUMBER_TOKEN)) {
      const rawWithSpacing = match[0]
      const leadingSpaces = rawWithSpacing.length - rawWithSpacing.trimStart().length
      const raw = rawWithSpacing.trim()
      const value = parseNumber(raw)
      if (value > 0) tokens.push({ raw, value, index: (match.index ?? 0) + leadingSpaces })
    }
    if (tokens.length < 2) return

    const explicitlyMarkedQty = tokens.find(token => /^x\s*/i.test(token.raw))
    const candidates = tokens.map((token, index) => ({
      value: token.value,
      start: index,
      end: index,
    }))
    tokens.forEach((first, index) => {
      const second = tokens[index + 1]
      if (
        second
        && Number.isInteger(first.value)
        && first.value > 0
        && first.value <= 999
        && /^\d{3}[.,]\d{3}$/.test(second.raw.replace(/^x\s*/i, ''))
      ) {
        candidates.push({
          value: parseNumber(`${first.raw}${second.raw}`),
          start: index,
          end: index + 1,
        })
      }
    })

    let arithmeticMatch: {
      qtyIndex: number
      unitValue: number
      totalEnd: number
      error: number
    } | null = null
    tokens.forEach((qtyToken, qtyIndex) => {
      if (!Number.isInteger(qtyToken.value) || qtyToken.value <= 0 || qtyToken.value > 10000) return
      for (const unit of candidates) {
        if (unit.start <= qtyIndex || unit.value <= 0) continue
        for (const total of candidates) {
          if (total.start <= unit.end || total.value <= 0) continue
          const expected = qtyToken.value * unit.value
          const error = Math.abs(expected - total.value) / Math.max(1, total.value)
          if (error > 0.015) continue
          if (!arithmeticMatch || error < arithmeticMatch.error) {
            arithmeticMatch = {
              qtyIndex,
              unitValue: unit.value,
              totalEnd: total.end,
              error,
            }
          }
        }
      }
    })

    let qtyToken = arithmeticMatch ? tokens[arithmeticMatch.qtyIndex] : explicitlyMarkedQty
    let qtyValue = qtyToken?.value ?? 0
    let priceValue = arithmeticMatch?.unitValue ?? 0
    let totalEndIndex = arithmeticMatch?.totalEnd ?? -1

    if (!qtyToken && tokens.length >= 2) {
      const maybeTva = [0, 7, 13, 19].includes(tokens[tokens.length - 1].value)
      const numericColumns = maybeTva ? tokens.slice(0, -1) : tokens
      const unit = numericColumns[numericColumns.length - 2]
      const total = numericColumns[numericColumns.length - 1]
      if (unit && total && Math.abs(unit.value - total.value) <= 0.001) {
        qtyToken = unit
        qtyValue = 1
        priceValue = unit.value
        totalEndIndex = tokens.indexOf(total)
      }
    }

    if (!qtyToken) {
      const withoutTrailingTva = (
        tokens.length >= 4
        && [0, 7, 13, 19].includes(tokens[tokens.length - 1].value)
      ) ? tokens.slice(0, -1) : tokens
      const positionalQty = withoutTrailingTva.length >= 3
        ? withoutTrailingTva[withoutTrailingTva.length - 3]
        : withoutTrailingTva[0]
      if (Number.isInteger(positionalQty.value) && positionalQty.value <= 10000) {
        qtyToken = positionalQty
        qtyValue = positionalQty.value
        const qtyIndex = tokens.indexOf(qtyToken)
        const afterQty = tokens.slice(qtyIndex + 1)
        if (afterQty.length) {
          priceValue = afterQty[0].value
          totalEndIndex = qtyIndex + Math.min(2, afterQty.length)
        }
      }
    } else if (!arithmeticMatch) {
      const qtyIndex = tokens.indexOf(qtyToken)
      const afterQty = tokens.slice(qtyIndex + 1)
      if (afterQty.length) {
        priceValue = afterQty[0].value
        totalEndIndex = qtyIndex + Math.min(2, afterQty.length)
      }
    }
    if (!qtyToken || priceValue <= 0) return

    const qtyIndex = tokens.indexOf(qtyToken)
    const designationTokens = tokens.filter((token, tokenIndex) =>
      (tokenIndex >= qtyIndex && tokenIndex <= Math.max(qtyIndex, totalEndIndex))
      || (
        tokenIndex > totalEndIndex
        && tokenIndex === tokens.length - 1
        && Number.isInteger(token.value)
        && token.value <= 200
      ),
    )
    const designation = cleanDesignation(sourceLine, designationTokens)
    if (!isPlausibleDesignation(designation)) return

    const hasExplicitQty = !!explicitlyMarkedQty
    parsed.push({
      id: `ocr-${lineIndex}-${Math.random().toString(36).slice(2, 8)}`,
      designation,
      quantite: Math.max(1, Math.round(qtyValue)),
      prixUnitaire: Math.max(0, priceValue),
      sourceLine,
      confidence: arithmeticMatch ? 'high' : hasExplicitQty ? 'medium' : 'low',
    })
  })

  return parsed
}

export function parseInvoiceMetadata(text: string): ParsedInvoiceMetadata {
  const metadata: ParsedInvoiceMetadata = {}
  const invoicePatterns = [
    /(?:facture|invoice)\s*(?:n[°oº]?|num[ée]ro|r[ée]f(?:[ée]rence)?|[:#-])\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
    /\b(?:n[°oº]|num[ée]ro)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
  ]
  const invoiceMatch = invoicePatterns.map(pattern => text.match(pattern)).find(Boolean)
  if (invoiceMatch && /\d/.test(invoiceMatch[1])) metadata.numeroFacture = invoiceMatch[1].trim()

  const dateMatch = text.match(/\b([0-3]?\d)[/.-]([01]?\d)[/.-]((?:19|20)\d{2})\b/)
  if (dateMatch) {
    const [, day, month, year] = dateMatch
    metadata.dateFacture = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    if (!metadata.numeroFacture && dateMatch.index != null) {
      const prefix = text.slice(Math.max(0, dateMatch.index - 120), dateMatch.index)
      const nearbyNumbers = [...prefix.matchAll(/\b(?:[A-Z]{1,4}\s*)?(\d{5,12})\b/gi)]
      const nearby = nearbyNumbers.at(-1)?.[1]
      if (nearby) metadata.numeroFacture = nearby
    }
  }
  return metadata
}
