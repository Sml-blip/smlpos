import { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null; errorInfo: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[SMLPOS] Rendering error caught by ErrorBoundary:', error)
    console.error('[SMLPOS] Component stack:', info.componentStack)
    this.setState({ errorInfo: info.componentStack })
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: '' })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-surface gap-5 p-8">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center">
            <AlertTriangle size={32} className="text-red-600" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-text-primary mb-2">Une erreur s'est produite</h1>
            <p className="text-text-secondary text-sm max-w-md">
              {this.state.error.message || 'Erreur inconnue'}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-text-primary font-bold rounded-xl transition-colors"
          >
            <RefreshCw size={15} />
            Réessayer
          </button>
          {process.env.NODE_ENV !== 'production' && this.state.errorInfo && (
            <details className="mt-2 w-full max-w-xl">
              <summary className="text-xs text-text-muted cursor-pointer">Détails techniques</summary>
              <pre className="mt-2 text-xs text-red-700 bg-red-50 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.errorInfo}
              </pre>
            </details>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
