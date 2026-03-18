import React from 'react'
import { LucideIcon } from 'lucide-react'

interface IconButtonProps {
  icon: LucideIcon
  onClick?: (e: React.MouseEvent) => void
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
}

export function IconButton({
  icon: Icon,
  onClick,
  className = '',
  size = 'md',
  variant = 'default',
  disabled = false,
  title,
}: IconButtonProps) {
  const sizeClasses = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3',
  }

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  }

  const variantClasses = {
    default: 'hover:bg-gray-100 text-gray-800',
    danger: 'hover:bg-red-50 text-red-500',
    ghost: 'hover:bg-transparent opacity-0 group-hover:opacity-100',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        rounded-md transition-all
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      <Icon className={iconSizes[size]} />
    </button>
  )
}
