import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  fallbackTitle?: string
  onReset?: () => void
  name?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    error: null
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ''}] caught:`, error, errorInfo)
  }

  reset = (): void => {
    this.props.onReset?.()
    this.setState({ hasError: false, error: null })
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error ?? new Error('Unknown error'), this.reset)
      }
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-base p-6 text-t1 select-none">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(229,72,77,0.28)] bg-[rgba(229,72,77,0.1)] text-[var(--color-error)] shadow-[var(--shadow-card)]">
            <AlertTriangle size={18} strokeWidth={1.5} />
          </div>
          <div className="max-w-sm text-center">
            <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-t1">
              {this.props.fallbackTitle ??
                (this.props.name
                  ? `${this.props.name} encountered an error`
                  : 'Something went wrong')}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed break-words text-t3">
              {this.state.error?.message || 'Unexpected application error.'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n3 px-3 text-[12px] font-medium text-t2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1"
          >
            <RotateCcw size={11} strokeWidth={1.75} />
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
