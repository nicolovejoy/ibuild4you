import React from 'react'
import { LucideIcon } from 'lucide-react'

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  loadingText?: string
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  fullWidth?: boolean
  children: React.ReactNode
}

export function LoadingButton({
  loading = false,
  loadingText,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}: LoadingButtonProps) {
  const baseClasses =
    'font-medium rounded-lg transition-colors flex items-center justify-center gap-2'

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  }

  const variantClasses = {
    primary:
      'bg-brand-navy text-white hover:bg-brand-navy-light disabled:bg-brand-slate disabled:cursor-not-allowed',
    secondary:
      'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed',
    danger:
      'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-300 disabled:cursor-not-allowed',
    ghost: 'text-gray-600 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed',
  }

  const LoadingSpinner = () => (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )

  return (
    <button
      disabled={disabled || loading}
      className={`
        ${baseClasses}
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <>
          <LoadingSpinner />
          {loadingText || children}
        </>
      ) : (
        <>
          {Icon && <Icon className="h-4 w-4" />}
          {children}
        </>
      )}
    </button>
  )
}
