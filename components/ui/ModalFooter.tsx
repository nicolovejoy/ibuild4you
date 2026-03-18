import React from 'react'

interface ModalFooterProps {
  children: React.ReactNode
  className?: string
}

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  return (
    <div className={`flex justify-end gap-3 pt-4 mt-6 border-t border-gray-200 ${className}`}>
      {children}
    </div>
  )
}
