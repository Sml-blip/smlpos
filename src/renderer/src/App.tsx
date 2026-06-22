import { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore, type TabId } from './store/appStore'
import ShiftModal from './components/ShiftModal'
import SplashScreen from './components/SplashScreen'
import LockScreen from './components/LockScreen'
import TitleBar from './components/TitleBar'
import StatusBar from './components/StatusBar'
import POSTab from './modules/pos/POSTab'
import HistoriqueTab from './modules/historique/HistoriqueTab'
import InventaireTab from './modules/inventaire/InventaireTab'
import DashboardTab from './modules/dashboard/DashboardTab'
import AchatsTab from './modules/achats/AchatsTab'
import CaisseInterneTab from './modules/caisse/CaisseInterneTab'
import VenteEnLigneTab from './modules/venteligne/VenteEnLigneTab'
import CreditsTab from './modules/credits/CreditsTab'
import RetoursTab from './modules/retours/RetoursTab'
import SettingsTab from './modules/settings/SettingsTab'
import ClientsTab from './modules/clients/ClientsTab'
import PersonnelsTab from './modules/personnels/PersonnelsTab'
import DocumentsTab from './modules/documents/DocumentsTab'
import {
  ShoppingCart, History, Package, LayoutDashboard, Truck,
  Vault, ShoppingBag, CreditCard, Settings, RotateCcw, Users, Users2, FolderOpen
} from 'lucide-react'
import { cn } from './lib/utils'
import { bootstrapSync, startSyncPolling } from './lib/sync'
import ToastProvider from './components/ToastProvider'
import { PrintManagerProvider } from './components/PrintManagerProvider'
import UpdateModal from './components/UpdateModal'
import { useAppUpdater } from './lib/useAppUpdater'
import { showToast } from './lib/toast'
import { applyAgentTheme, loadAgentTheme } from './lib/agentTheme'
import type { Operateur, Shift } from './lib/types'

const api = window.api

const TABS: { id: TabId; label: string; icon: React.ReactNode; short: string }[] = [
  { id: 'pos',            label: 'Point de Vente',   short: 'POS',        icon: <ShoppingCart size={13} /> },
  { id: 'historique',     label: 'Historique',        short: 'Historique', icon: <History size={13} /> },
  { id: 'inventaire',     label: 'Inventaire',        short: 'Inventaire', icon: <Package size={13} /> },
  { id: 'achats',         label: 'Achats',            short: 'Achats',     icon: <Truck size={13} /> },
  { id: 'vente_en_ligne', label: 'Ventes en Ligne',   short: 'En Ligne',   icon: <ShoppingBag size={13} /> },
  { id: 'clients',        label: 'Clients',           short: 'Clients',    icon: <Users size={13} /> },
  { id: 'credits',        label: 'Crédits Clients',   short: 'Crédits',    icon: <CreditCard size={13} /> },
  { id: 'retours',        label: 'Retours',           short: 'Retours',    icon: <RotateCcw size={13} /> },
  { id: 'personnels',     label: 'Personnels',        short: 'Personnels', icon: <Users2 size={13} /> },
  { id: 'caisse_interne', label: 'Caisse Interne',    short: 'Trésorerie', icon: <Vault size={13} /> },
  { id: 'documents',      label: 'Documents',         short: 'Documents',  icon: <FolderOpen size={13} /> },
  { id: 'dashboard',      label: 'Tableau de bord',   short: 'Dashboard',  icon: <LayoutDashboard size={13} /> },
  { id: 'settings',       label: 'Paramètres',        short: 'Paramètres', icon: <Settings size={13} /> },
]

export default function App() {
  const { showShiftModal, activeTab, setActiveTab, setOperateurs, setIsOnline, currentOperateur,
    setCurrentShift, setCurrentOperateur, setShowShiftModal } = useAppStore()
  const [showSplash, setShowSplash] = useState(true)
  const [locked, setLocked] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [appVersion, setAppVersion] = useState('1.9.2')
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { status: updateStatus, showModal: showUpdateModal, checkForUpdates, installUpdate, dismissError } = useAppUpdater(appVersion)

  const setupLock = useCallback(async () => {
    try {
      const settings = await api.settingsGetAll()
      if (settings.demo_mode === 'true') return
      const minutes = parseInt(settings.lock_screen_minutes ?? '30') || 0
      if (minutes === 0 || !currentOperateur) return

      const resetTimer = () => {
        if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
        lockTimerRef.current = setTimeout(() => setLocked(true), minutes * 60 * 1000)
      }

      const opId = currentOperateur.identifiant.toLowerCase()
      setCurrentPin(settings[`pin_${opId}`] ?? settings.caisse_interne_pin ?? 'sml2023')

      window.addEventListener('mousemove', resetTimer)
      window.addEventListener('keydown', resetTimer)
      window.addEventListener('click', resetTimer)
      resetTimer()

      return () => {
        if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
        window.removeEventListener('mousemove', resetTimer)
        window.removeEventListener('keydown', resetTimer)
        window.removeEventListener('click', resetTimer)
      }
    } catch { /* settings not ready */ }
  }, [currentOperateur])

  useEffect(() => {
    api.appVersion?.().then(v => { if (v) setAppVersion(v) }).catch(() => {})

    api.operateursList().then((ops) => {
      if (ops) setOperateurs(ops as Operateur[])
    })

    // Restore open shift so demo doesn't re-block on ShiftModal
    api.shiftsGetActive().then(async (shift) => {
      if (!shift) return
      const s = shift as Shift
      setCurrentShift(s)
      const ops = await api.operateursList() as Operateur[]
      const op = ops.find(o => o.id === s.operateur_id || o.nom === s.operateur_nom)
      if (op) setCurrentOperateur(op)
      else setCurrentOperateur({ id: s.operateur_id ?? '', nom: s.operateur_nom, identifiant: s.operateur_nom.toLowerCase(), role: 'caissier', actif: 1 })
      setShowShiftModal(false)
    }).catch(() => { /* no active shift */ })

    api.appHealth?.().then((h: { ok?: boolean; error?: string } | undefined) => {
      if (h && !h.ok) showToast('error', `Base de données : ${h.error ?? 'erreur'}`)
    }).catch(() => { /* health optional in browser */ })

    bootstrapSync().then(() => startSyncPolling())
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    setupLock().then(fn => { cleanup = fn })
    return () => cleanup?.()
  }, [setupLock])

  useEffect(() => {
    applyAgentTheme(loadAgentTheme(currentOperateur?.id))
  }, [currentOperateur?.id])

  return (
    <PrintManagerProvider>
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      {locked && currentPin && (
        <LockScreen
          operateurNom={currentOperateur?.nom ?? ''}
          pin={currentPin}
          onUnlock={() => setLocked(false)}
        />
      )}

      <TitleBar />

      {/* Tab Navigation — scrollable to fit all 12 tabs */}
      <div className="flex items-center gap-0 bg-[var(--bg-primary)] border-b border-border px-2 pt-1 flex-shrink-0 overflow-x-auto">
        {TABS.map(tab => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap flex-shrink-0',
                active
                  ? 'border-accent-500 text-text-primary bg-accent-50'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-muted'
              )}
            >
              {tab.icon}
              {tab.short}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'            && <POSTab />}
        {activeTab === 'historique'     && <HistoriqueTab />}
        {activeTab === 'inventaire'     && <InventaireTab />}
        {activeTab === 'achats'         && <AchatsTab />}
        {activeTab === 'dashboard'      && <DashboardTab />}
        {activeTab === 'caisse_interne' && <CaisseInterneTab />}
        {activeTab === 'vente_en_ligne' && <VenteEnLigneTab />}
        {activeTab === 'credits'        && <CreditsTab />}
        {activeTab === 'retours'        && <RetoursTab />}
        {activeTab === 'clients'        && <ClientsTab />}
        {activeTab === 'personnels'     && <PersonnelsTab />}
        {activeTab === 'documents'      && <DocumentsTab />}
        {activeTab === 'settings'       && <SettingsTab />}
      </div>

      <StatusBar />

      {showShiftModal && <ShiftModal />}

      {showUpdateModal && (
        <UpdateModal
          status={updateStatus}
          currentVersion={appVersion}
          onInstall={installUpdate}
          onRetry={() => checkForUpdates(true)}
          onDismiss={updateStatus.state === 'error' ? dismissError : undefined}
        />
      )}

      <ToastProvider />
    </div>
    </PrintManagerProvider>
  )
}
