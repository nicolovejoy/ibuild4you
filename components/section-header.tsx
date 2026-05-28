'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export function SectionHeader({
  backHref,
  title,
  icon,
  meta,
  sticky = true,
}: {
  backHref: string
  title: string
  icon?: ReactNode
  meta?: ReactNode
  sticky?: boolean
}) {
  const router = useRouter()
  return (
    <header
      className={`bg-white border-b border-gray-200 ${sticky ? 'sticky top-0 z-10' : ''}`}
    >
      <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
        <button
          onClick={() => router.push(backHref)}
          className="p-1 hover:bg-gray-100 rounded"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </button>
        {icon}
        <h1 className="font-semibold text-brand-charcoal">{title}</h1>
        {meta}
      </div>
    </header>
  )
}
