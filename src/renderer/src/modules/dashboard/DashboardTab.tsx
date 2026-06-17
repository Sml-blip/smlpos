import { useState, useEffect, useCallback } from 'react'
import { formatPrice } from '../../lib/utils'
import { loadData } from '../../lib/apiCall'
import { cn } from '../../lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  TrendingUp, TrendingDown, ShoppingBag, Wrench,
  AlertTriangle, RefreshCw, Package, Star
} from 'lucide-react'

const api = window.api

interface DailyVente {
  date: string
  total: number
  count: number
}

interface ModeData {
  mode_paiement: string
  count: number
  total: number
}

interface LowStockItem {
  nom: string
  stock_actuel: number
  stock_minimum: number
}

interface TopProduit {
  designation: string
  revenue: number
  qty: number
}

interface DashboardData {
  dailyVentes: DailyVente[]
  todayVentes: { total: number; count: number }
  yestVentes: { total: number; count: number }
  repsEnCours: { count: number }
  parMode: ModeData[]
  lowStock: LowStockItem[]
  topProduits: TopProduit[]
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte',
  CHEQUE: 'Chèque',
  MIXTE: 'Mixte',
}

const MODE_COLORS: Record<string, string> = {
  ESPECES: '#4CAF50',
  CARTE: '#2196F3',
  CHEQUE: '#FF9800',
  MIXTE: '#9C27B0',
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function StatCard({
  label,
  value,
  sub,
  trend,
  icon,
  color = 'default',
}: {
  label: string
  value: string
  sub?: string
  trend?: { pct: number; up: boolean } | null
  icon: React.ReactNode
  color?: 'default' | 'green' | 'blue' | 'orange' | 'red'
}) {
  const colors = {
    default: 'bg-white',
    green: 'bg-green-50 border-green-200',
    blue: 'bg-blue-50 border-blue-200',
    orange: 'bg-orange-50 border-orange-200',
    red: 'bg-red-50 border-red-200',
  }
  return (
    <div className={cn('rounded-xl border p-4 shadow-card', colors[color])}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">{icon} {label}</div>
        {trend && (
          <div className={cn('flex items-center gap-0.5 text-xs font-semibold', trend.up ? 'text-success' : 'text-danger')}>
            {trend.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend.pct).toFixed(0)}%
          </div>
        )}
      </div>
      <div className="text-xl font-bold font-price">{value}</div>
      {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl px-3 py-2 shadow-card text-xs">
        <div className="font-semibold text-text-secondary mb-1">{label}</div>
        <div className="font-price font-bold text-text-primary">{formatPrice(payload[0].value)}</div>
      </div>
    )
  }
  return null
}

const PieTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border rounded-xl px-3 py-2 shadow-card text-xs">
        <div className="font-semibold">{payload[0].name}</div>
        <div className="font-price font-bold">{formatPrice(payload[0].value)}</div>
      </div>
    )
  }
  return null
}

export default function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState<'7' | '30'>('30')

  const load = useCallback(async () => {
    const result = await loadData('Chargement tableau de bord', () => api.statsDashboard() as Promise<DashboardData>, { setLoading })
    if (result) setData(result)
  }, [])

  useEffect(() => { load() }, [load])

  const chartData = data
    ? data.dailyVentes.slice(period === '7' ? -7 : -30).map(d => ({
        date: formatShortDate(d.date),
        total: d.total,
        count: d.count,
      }))
    : []

  const pieData = data
    ? data.parMode.map(m => ({
        name: MODE_LABELS[m.mode_paiement] || m.mode_paiement,
        value: m.total,
        color: MODE_COLORS[m.mode_paiement] || '#999',
      }))
    : []

  const todayTrend = data && data.yestVentes.total > 0
    ? {
        pct: ((data.todayVentes.total - data.yestVentes.total) / data.yestVentes.total) * 100,
        up: data.todayVentes.total >= data.yestVentes.total,
      }
    : null

  return (
    <div className="h-full overflow-y-auto bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-border sticky top-0 z-10">
        <h2 className="font-bold text-sm text-text-primary">Tableau de Bord</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            {[
              { id: '7', label: '7 jours' },
              { id: '30', label: '30 jours' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as '7' | '30')}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                  period === p.id ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-muted transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Ventes aujourd'hui"
            value={data ? formatPrice(data.todayVentes.total) : '—'}
            sub={data ? `${data.todayVentes.count} transaction${data.todayVentes.count > 1 ? 's' : ''}` : ''}
            trend={todayTrend}
            icon={<ShoppingBag size={12} />}
            color="green"
          />
          <StatCard
            label="Hier"
            value={data ? formatPrice(data.yestVentes.total) : '—'}
            sub={data ? `${data.yestVentes.count} transaction${data.yestVentes.count > 1 ? 's' : ''}` : ''}
            icon={<TrendingUp size={12} />}
          />
          <StatCard
            label="Réparations en cours"
            value={data ? String(data.repsEnCours.count) : '—'}
            sub="En attente ou en cours"
            icon={<Wrench size={12} />}
            color={data && data.repsEnCours.count > 0 ? 'orange' : 'default'}
          />
          <StatCard
            label="Stock bas"
            value={data ? String(data.lowStock.length) : '—'}
            sub="Produits à réapprovisionner"
            icon={<AlertTriangle size={12} />}
            color={data && data.lowStock.length > 0 ? 'red' : 'default'}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Daily sales bar chart */}
          <div className="col-span-2 bg-white rounded-xl border border-border p-4 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <TrendingUp size={14} />
                Ventes — {period === '7' ? '7 derniers jours' : '30 derniers jours'}
              </h3>
              <div className="text-xs text-text-muted font-price font-semibold">
                Total: {formatPrice(chartData.reduce((s, d) => s + d.total, 0))}
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-text-muted text-xs">
                <ShoppingBag size={24} className="mb-2 opacity-30" />
                Aucune donnée pour cette période
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#9E9E9E' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#9E9E9E' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" fill="#FFD600" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Payment methods pie */}
          <div className="bg-white rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
              <ShoppingBag size={14} />
              Modes de paiement
            </h3>
            {pieData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-text-muted text-xs">
                <ShoppingBag size={24} className="mb-2 opacity-30" />
                Aucune vente
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={60}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-1">
                  {pieData.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                        <span className="text-text-secondary">{m.name}</span>
                      </div>
                      <span className="font-price font-semibold">{formatPrice(m.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Top products */}
          <div className="bg-white rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
              <Star size={14} />
              Top 5 produits ({period} jours)
            </h3>
            {!data || data.topProduits.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">Aucun produit vendu</div>
            ) : (
              <div className="space-y-2">
                {data.topProduits.map((p, i) => {
                  const maxRevenue = data.topProduits[0].revenue
                  const pct = (p.revenue / maxRevenue) * 100
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full bg-accent-50 border border-accent-400 flex items-center justify-center text-xs font-bold text-text-primary flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{p.designation}</div>
                        <div className="mt-0.5 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-price font-bold">{formatPrice(p.revenue)}</div>
                        <div className="text-xs text-text-muted">×{p.qty}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Low stock alert */}
          <div className="bg-white rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
              <AlertTriangle size={14} className={data && data.lowStock.length > 0 ? 'text-warning' : ''} />
              Alertes stock bas
            </h3>
            {!data || data.lowStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-success text-xs">
                <Package size={24} className="mb-2" />
                Tous les stocks sont OK !
              </div>
            ) : (
              <div className="space-y-2">
                {data.lowStock.map((p, i) => {
                  const pct = p.stock_minimum > 0 ? (p.stock_actuel / p.stock_minimum) * 100 : 100
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                        p.stock_actuel === 0 ? 'bg-red-100 text-danger' : 'bg-orange-100 text-warning'
                      )}>
                        {p.stock_actuel}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{p.nom}</div>
                        <div className="mt-0.5 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', p.stock_actuel === 0 ? 'bg-danger' : 'bg-warning')}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-text-muted">Min: {p.stock_minimum}</div>
                      </div>
                    </div>
                  )
                })}
                {data.lowStock.length >= 5 && (
                  <div className="text-xs text-text-muted text-center pt-1">
                    Voir plus dans l'onglet Inventaire
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
