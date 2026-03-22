'use client'

import {
  Image, AlignLeft, MousePointerClick, LayoutGrid, ClipboardList,
  Mail, Menu, Minus, MapPin, Play, Box,
} from 'lucide-react'
import type { WireframeMockup, WireframeSection } from '@/lib/types'
import type { LucideIcon } from 'lucide-react'

// Each section type maps to a color palette and icon.
// Unknown types fall back to gray/Box so the agent can invent new types
// without breaking the UI.
const SECTION_STYLES: Record<string, { icon: LucideIcon; bg: string; border: string; iconColor: string }> = {
  hero:    { icon: Image,             bg: 'bg-amber-50',   border: 'border-amber-200',   iconColor: 'text-amber-500' },
  text:    { icon: AlignLeft,         bg: 'bg-blue-50',    border: 'border-blue-200',     iconColor: 'text-blue-500' },
  cta:     { icon: MousePointerClick, bg: 'bg-green-50',   border: 'border-green-200',    iconColor: 'text-green-600' },
  gallery: { icon: LayoutGrid,        bg: 'bg-purple-50',  border: 'border-purple-200',   iconColor: 'text-purple-500' },
  form:    { icon: ClipboardList,     bg: 'bg-rose-50',    border: 'border-rose-200',     iconColor: 'text-rose-500' },
  signup:  { icon: Mail,              bg: 'bg-teal-50',    border: 'border-teal-200',     iconColor: 'text-teal-500' },
  nav:     { icon: Menu,              bg: 'bg-gray-50',    border: 'border-gray-200',     iconColor: 'text-gray-500' },
  footer:  { icon: Minus,             bg: 'bg-gray-50',    border: 'border-gray-200',     iconColor: 'text-gray-400' },
  map:     { icon: MapPin,            bg: 'bg-emerald-50', border: 'border-emerald-200',  iconColor: 'text-emerald-500' },
  video:   { icon: Play,              bg: 'bg-indigo-50',  border: 'border-indigo-200',   iconColor: 'text-indigo-500' },
}

const DEFAULT_STYLE = { icon: Box, bg: 'bg-gray-50', border: 'border-gray-200', iconColor: 'text-gray-400' }

function getStyle(type: string) {
  return SECTION_STYLES[type] || DEFAULT_STYLE
}

// --- Single section block ---

function WireframeSectionBlock({ section }: { section: WireframeSection }) {
  const style = getStyle(section.type)
  const Icon = style.icon

  return (
    <div className={`flex items-start gap-3 rounded-lg border-l-4 px-3 py-2.5 ${style.bg} ${style.border}`}>
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${style.iconColor}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{section.label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
      </div>
    </div>
  )
}

// --- Page group (for multi-page layouts) ---

function WireframePage({ pageName, sections }: { pageName: string; sections: WireframeSection[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 mt-3 first:mt-0">
        {pageName}
      </p>
      <div className="space-y-1.5">
        {sections.map((section, i) => (
          <WireframeSectionBlock key={i} section={section} />
        ))}
      </div>
    </div>
  )
}

// --- Main component ---

export function WireframePreview({ mockup }: { mockup: WireframeMockup }) {
  if (!mockup.sections || mockup.sections.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400">
        Empty layout
      </div>
    )
  }

  // Check if any section has a page field — if so, group by page
  const isMultiPage = mockup.sections.some((s) => s.page)

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden my-2">
      {/* Title bar */}
      <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-700">{mockup.title || 'Layout'}</p>
      </div>

      {/* Sections */}
      <div className="p-3 space-y-1.5">
        {isMultiPage ? (
          // Group sections by page name, preserving order of first appearance
          (() => {
            const pages: { name: string; sections: WireframeSection[] }[] = []
            const pageMap = new Map<string, WireframeSection[]>()
            for (const section of mockup.sections) {
              const pageName = section.page || 'Other'
              if (!pageMap.has(pageName)) {
                const arr: WireframeSection[] = []
                pageMap.set(pageName, arr)
                pages.push({ name: pageName, sections: arr })
              }
              pageMap.get(pageName)!.push(section)
            }
            return pages.map((page) => (
              <WireframePage key={page.name} pageName={page.name} sections={page.sections} />
            ))
          })()
        ) : (
          mockup.sections.map((section, i) => (
            <WireframeSectionBlock key={i} section={section} />
          ))
        )}
      </div>
    </div>
  )
}
