import type { CartItem, LigneVente, Vente } from './types'

type TicketLine = Pick<CartItem | LigneVente, 'designation' | 'quantite' | 'prix_unitaire' | 'remise_pct' | 'total_ligne'>

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Especes',
  CARTE: 'Carte',
  CHEQUE: 'Cheque',
  MIXTE: 'Mixte',
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function fmt(amount: number | null | undefined): string {
  const n = Number(amount)
  return Number.isFinite(n) ? `${n.toFixed(3)} DT` : '0.000 DT'
}

function formatDateParts(value: string): { date: string; time: string } {
  const date = new Date(value)
  return {
    date: date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function buildReceiptTicketHtml(vente: Vente, lines: TicketLine[]): string {
  const { date, time } = formatDateParts(vente.created_at)
  const itemsHtml = lines.map((line) => {
    const remise = Number(line.remise_pct) || 0
    const unit = Number(line.prix_unitaire) * (1 - remise / 100)
    return `
      <div class="item">
        <div class="item-main">
          <span class="item-name">${escapeHtml(line.designation)}</span>
          <span class="item-total">${fmt(line.total_ligne)}</span>
        </div>
        <div class="item-meta">
          ${escapeHtml(line.quantite)} x ${fmt(unit)}${remise > 0 ? ` (-${remise}%)` : ''}
        </div>
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Ticket ${escapeHtml(vente.numero)}</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: "Arial", "Helvetica", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      width: 100%;
      font-size: 12px;
      line-height: 1.35;
    }
    .ticket {
      width: 100%;
      padding: 3mm 2.5mm;
      background: #fff;
    }
    .center { text-align: center; }
    .brand {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 1px;
      line-height: 1.1;
    }
    .muted {
      color: #333;
      font-size: 11px;
      line-height: 1.3;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 7px 0;
      height: 0;
    }
    .item {
      padding: 3px 0;
      break-inside: avoid;
    }
    .item-main,
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
    }
    .item-name {
      flex: 1;
      overflow-wrap: anywhere;
      font-weight: 700;
    }
    .item-total,
    .money {
      white-space: nowrap;
      text-align: right;
      font-weight: 700;
    }
    .item-meta {
      color: #333;
      font-size: 11px;
      padding-top: 1px;
    }
    .totals {
      font-size: 12px;
    }
    .total {
      font-size: 15px;
      font-weight: 900;
      padding-top: 4px;
      margin-top: 3px;
      border-top: 1px solid #000;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      line-height: 1.35;
      margin-top: 8px;
    }
    @media screen {
      body {
        min-height: 100%;
      }
      .ticket {
        min-height: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <div class="brand">SMLPOS</div>
      <div class="muted">Systeme de Point de Vente</div>
      <div class="muted">${date} - ${time}</div>
      <div class="muted">Ticket No ${escapeHtml(vente.numero)}</div>
      ${vente.operateur_nom ? `<div class="muted">Caissier: ${escapeHtml(vente.operateur_nom)}</div>` : ''}
    </div>

    <div class="divider"></div>
    ${itemsHtml || '<div class="muted center">Aucune ligne</div>'}
    <div class="divider"></div>

    <div class="totals">
      ${Number(vente.total_remises) > 0 ? `
        <div class="row"><span>Sous-total</span><span class="money">${fmt(vente.sous_total)}</span></div>
        <div class="row"><span>Remises</span><span class="money">-${fmt(vente.total_remises)}</span></div>
      ` : ''}
      <div class="row total"><span>TOTAL TTC</span><span>${fmt(vente.total_ttc)}</span></div>
      <div class="row"><span>Mode paiement</span><span class="money">${escapeHtml(MODE_LABELS[vente.mode_paiement] || vente.mode_paiement)}</span></div>
      ${vente.mode_paiement === 'ESPECES' && vente.montant_recu != null ? `
        <div class="row"><span>Recu</span><span class="money">${fmt(vente.montant_recu)}</span></div>
        <div class="row"><span>Monnaie</span><span class="money">${fmt(vente.monnaie_rendue ?? 0)}</span></div>
      ` : ''}
    </div>

    <div class="divider"></div>
    <div class="footer">
      <div>Merci pour votre confiance</div>
      <div>Bonne journee !</div>
    </div>
  </div>
</body>
</html>`
}
