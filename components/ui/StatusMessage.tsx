import React from 'react'
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'

interface StatusMessageProps {
  type: 'error' | 'success' | 'warning' | 'info'
  message: string
  onDismiss?: () => void
  className?: string
}

export function StatusMessage({ type, message, onDismiss, className = '' }: StatusMessageProps) {
  const styles = {
    error: {
      bg: 'bg-red-50',
      text: 'text-red-800',
      border: 'border-red-200',
      icon: XCircle,
      iconColor: 'text-red-400',
    },
    success: {
      bg: 'bg-green-50',
      text: 'text-green-800',
      border: 'border-green-200',
      icon: CheckCircle,
      iconColor: 'text-green-400',
    },
    warning: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-800',
      border: 'border-yellow-200',
      icon: AlertCircle,
      iconColor: 'text-yellow-400',
    },
    info: {
      bg: 'bg-blue-50',
      text: 'text-blue-800',
      border: 'border-blue-200',
      icon: Info,
      iconColor: 'text-blue-400',
    },
  }

  const style = styles[type]
  const Icon = style.icon

  return (
    <div className={`rounded-lg p-4 border ${style.bg} ${style.border} ${className}`} role="alert">
      <div className="flex">
        <Icon className={`h-5 w-5 ${style.iconColor} flex-shrink-0`} />
        <div className="ml-3 flex-1">
          <p className={`text-sm ${style.text}`}>{message}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`ml-auto -mx-1.5 -my-1.5 ${style.bg} ${style.text} rounded-lg p-1.5 inline-flex h-8 w-8 hover:bg-opacity-75`}
            aria-label="Dismiss"
          >
            <XCircle className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}
