/** Shared product pricing math (inventaire + achats) */

export interface PricingFormSlice {
  prix_achat: string
  cout_supplementaire: string
  tva_achat_pct: string
  tva_taux: string
  prix_vente: string
  marge_pct: string
  coef_av: string
  prix_achat_ttc?: string
}

export function computeProductPricing(data: PricingFormSlice) {
  const prixAchatHT = parseFloat(data.prix_achat) || 0
  const coutSupp = parseFloat(data.cout_supplementaire) || 0
  const tvaAchat = parseFloat(data.tva_achat_pct) || 0
  const tvaTaux = parseFloat(data.tva_taux) || 0
  const coutRevient = prixAchatHT + coutSupp
  const prixAchatTTC = coutRevient * (1 + tvaAchat / 100)
  const prixVente = parseFloat(data.prix_vente) || 0
  const prixVenteHT = tvaTaux > 0 ? prixVente / (1 + tvaTaux / 100) : prixVente
  const coef = coutRevient > 0 ? prixVenteHT / coutRevient : 0
  const marge = (coef - 1) * 100
  const isBelowCost = coutRevient > 0 && prixVente < prixAchatTTC
  return { coutRevient, prixAchatTTC, prixVenteHT, coef, marge, isBelowCost, tvaAchat, tvaTaux, coutSupp }
}

/** User edits Prix Achat TTC → back-calculate HT */
export function pricingFromPrixAchatTtc(
  data: PricingFormSlice,
  prixAchatTtcStr: string,
): Partial<PricingFormSlice> {
  const tvaAchat = parseFloat(data.tva_achat_pct) || 0
  const coutSupp = parseFloat(data.cout_supplementaire) || 0
  const ttc = parseFloat(prixAchatTtcStr.replace(',', '.')) || 0
  const coutRevient = tvaAchat > 0 ? ttc / (1 + tvaAchat / 100) : ttc
  const prixAchatHT = Math.max(0, coutRevient - coutSupp)
  return {
    prix_achat_ttc: prixAchatTtcStr,
    prix_achat: prixAchatHT > 0 ? prixAchatHT.toFixed(3) : '0',
  }
}

export function pricingFromMargePct(data: PricingFormSlice, val: string): Partial<PricingFormSlice> {
  const marge = parseFloat(val)
  const { coutRevient, tvaTaux } = computeProductPricing(data)
  const newCoef = 1 + marge / 100
  const pvHT = coutRevient * newCoef
  const pvTTC = pvHT * (1 + tvaTaux / 100)
  return {
    marge_pct: val,
    coef_av: isNaN(newCoef) ? data.coef_av : newCoef.toFixed(4),
    prix_vente: isNaN(pvTTC) || coutRevient === 0 ? data.prix_vente : pvTTC.toFixed(3),
  }
}

export function pricingFromCoefAv(data: PricingFormSlice, val: string): Partial<PricingFormSlice> {
  const coef = parseFloat(val)
  const { coutRevient, tvaTaux } = computeProductPricing(data)
  const newMarge = (coef - 1) * 100
  const pvHT = coutRevient * coef
  const pvTTC = pvHT * (1 + tvaTaux / 100)
  return {
    coef_av: val,
    marge_pct: isNaN(newMarge) ? data.marge_pct : newMarge.toFixed(2),
    prix_vente: isNaN(pvTTC) || coutRevient === 0 ? data.prix_vente : pvTTC.toFixed(3),
  }
}

export function pricingFromPrixVente(data: PricingFormSlice, val: string): Partial<PricingFormSlice> {
  const pv = parseFloat(val.replace(',', '.')) || 0
  const { coutRevient, tvaTaux } = computeProductPricing(data)
  const pvHT = tvaTaux > 0 ? pv / (1 + tvaTaux / 100) : pv
  const coef = coutRevient > 0 ? pvHT / coutRevient : 0
  const marge = (coef - 1) * 100
  return {
    prix_vente: val,
    coef_av: coutRevient > 0 && !isNaN(coef) ? coef.toFixed(4) : data.coef_av,
    marge_pct: coutRevient > 0 && !isNaN(marge) ? marge.toFixed(2) : data.marge_pct,
  }
}
