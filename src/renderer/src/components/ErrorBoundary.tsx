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
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 select-none bg-base text-t1">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-n3 p-3 text-[var(--color-error)]">
            <AlertTriangle size={18} strokeWidth={1.5} />
          </div>
          <div className="text-center max-w-sm">
            <p className="text-[13px] font-medium text-t1">
              {this.props.fallbackTitle ??
                (this.props.name
                  ? `${this.props.name} encountered an error`
                  : 'Something went wrong')}
            </p>
            <p className="mt-1 text-[11.5px] text-t4 break-words">
              {this.state.error?.message || 'Unexpected application error.'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n3 px-3 text-[11.5px] text-t2 transition-colors hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1"
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
