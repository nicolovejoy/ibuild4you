'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, Plus, X } from 'lucide-react'
import { WireframePreview, SECTION_STYLES, SECTION_TYPES } from '@/components/ui/WireframePreview'
import type { WireframeMockup, WireframeSection } from '@/lib/types'

// --- Exported pure functions (tested) ---

export function validateMockup(title: string, sections: WireframeSection[]): string | null {
  if (!title.trim()) return 'Title is required'
  if (sections.length === 0) return 'Add at least one section'
  if (sections.some((s) => !s.label.trim())) return 'Every section needs a label'
  return null
}

export function moveSection(sections: WireframeSection[], index: number, direction: 'up' | 'down'): WireframeSection[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= sections.length) return [...sections]
  const next = [...sections]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function parseJsonMockup(text: string): { mockup: WireframeMockup | null; error: string | null } {
  try {
    const obj = JSON.parse(text)
    if (!obj || typeof obj.title !== 'string' || !Array.isArray(obj.sections)) {
      return { mockup: null, error: 'JSON must have "title" (string) and "sections" (array)' }
    }
    return { mockup: obj as WireframeMockup, error: null }
  } catch {
    return { mockup: null, error: 'Invalid JSON' }
  }
}

// --- Section row in form editor ---

function SectionRow({
  section,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  section: WireframeSection
  index: number
  total: number
  onChange: (updated: WireframeSection) => void
  onMove: (direction: 'up' | 'down') => void
  onRemove: () => void
}) {
  const style = SECTION_STYLES[section.type] || SECTION_STYLES.text

  return (
    <div className="flex items-start gap-2 p-2 rounded-lg border border-gray-200 bg-white">
      {/* Reorder + type indicator */}
      <div className="flex flex-col items-center gap-0.5 pt-1">
        <button
          onClick={() => onMove('up')}
          disabled={index === 0}
          className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move up"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        {/* Colored dot showing section type */}
        <div className={`w-2.5 h-2.5 rounded-full ${style.bg} border ${style.border}`} />
        <button
          onClick={() => onMove('down')}
          disabled={index === total - 1}
          className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move down"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 space-y-1.5 min-w-0">
        <div className="flex gap-2">
          <select
            value={section.type}
            onChange={(e) => onChange({ ...section, type: e.target.value })}
            className="px-2 py-1 border border-gray-300 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          >
            {SECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={section.label}
            onChange={(e) => onChange({ ...section, label: e.target.value })}
            placeholder="Label (e.g. Welcome Hero)"
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          />
        </div>
        <input
          type="text"
          value={section.description}
          onChange={(e) => onChange({ ...section, description: e.target.value })}
          placeholder="Description (e.g. Hero photo grid showing range of offerings)"
          className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
        />
        {section.page !== undefined && (
          <input
            type="text"
            value={section.page || ''}
            onChange={(e) => onChange({ ...section, page: e.target.value || undefined })}
            placeholder="Page name (e.g. Home)"
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          />
        )}
      </div>

      {/* Remove */}
      <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500 mt-1" aria-label="Remove section">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// --- Main component ---

export function MockupEditor({ mockups, onUpdate }: { mockups: WireframeMockup[]; onUpdate: (m: WireframeMockup[]) => void }) {
  const [editorMode, setEditorMode] = useState<'form' | 'json'>('form')
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  // Form mode state
  const [title, setTitle] = useState('')
  const [sections, setSections] = useState<WireframeSection[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  // JSON mode state
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const resetForm = () => {
    setTitle('')
    setSections([])
    setFormError(null)
  }

  const handleAddSection = () => {
    setSections([...sections, { type: 'text', label: '', description: '' }])
    setFormError(null)
  }

  const handleUpdateSection = (index: number, updated: WireframeSection) => {
    const next = [...sections]
    next[index] = updated
    setSections(next)
    setFormError(null)
  }

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    setSections(moveSection(sections, index, direction))
  }

  const handleRemoveSection = (index: number) => {
    setSections(sections.filter((_, i) => i !== index))
  }

  const handleAddMockupFromForm = () => {
    const error = validateMockup(title, sections)
    if (error) {
      setFormError(error)
      return
    }
    onUpdate([...mockups, { title: title.trim(), sections }])
    resetForm()
  }

  const handleAddMockupFromJson = () => {
    const { mockup, error } = parseJsonMockup(jsonInput)
    if (error || !mockup) {
      setJsonError(error)
      return
    }
    onUpdate([...mockups, mockup])
    setJsonInput('')
    setJsonError(null)
  }

  // Live preview of what's currently being edited
  const formPreview: WireframeMockup | null =
    (title.trim() || sections.length > 0)
      ? { title: title || 'Untitled', sections }
      : null

  let jsonPreview: WireframeMockup | null = null
  if (jsonInput.trim()) {
    const { mockup } = parseJsonMockup(jsonInput)
    jsonPreview = mockup
  }

  const preview = editorMode === 'form' ? formPreview : jsonPreview

  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">Layout mockups</label>
      <p className="text-xs text-gray-500 mb-2">Wireframe layouts the agent can show to the maker during conversation.</p>

      {/* Existing mockups */}
      {mockups.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {mockups.map((m, i) => (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                <button
                  onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                  className="text-sm font-medium text-gray-700 hover:text-brand-navy flex items-center gap-1.5"
                >
                  {expandedIndex === i ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {m.title}
                  <span className="text-xs text-gray-400 font-normal">{m.sections.length} section{m.sections.length === 1 ? '' : 's'}</span>
                </button>
                <button onClick={() => onUpdate(mockups.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {expandedIndex === i && (
                <div className="px-3 pb-2">
                  <WireframePreview mockup={m} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setEditorMode('form')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            editorMode === 'form' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Form
        </button>
        <button
          onClick={() => setEditorMode('json')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            editorMode === 'json' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          JSON
        </button>
      </div>

      {editorMode === 'form' ? (
        /* --- Form mode --- */
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setFormError(null) }}
            placeholder="Mockup title (e.g. Strategy A: Single Page)"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          />

          {sections.length > 0 && (
            <div className="space-y-1.5">
              {sections.map((s, i) => (
                <SectionRow
                  key={i}
                  section={s}
                  index={i}
                  total={sections.length}
                  onChange={(updated) => handleUpdateSection(i, updated)}
                  onMove={(dir) => handleMoveSection(i, dir)}
                  onRemove={() => handleRemoveSection(i)}
                />
              ))}
            </div>
          )}

          <button
            onClick={handleAddSection}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-navy"
          >
            <Plus className="h-3.5 w-3.5" />
            Add section
          </button>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <button
            onClick={handleAddMockupFromForm}
            disabled={!title.trim() && sections.length === 0}
            className="flex items-center gap-1 text-sm text-brand-navy hover:text-brand-navy-light disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Add mockup
          </button>
        </div>
      ) : (
        /* --- JSON mode --- */
        <div>
          <textarea
            value={jsonInput}
            onChange={(e) => { setJsonInput(e.target.value); setJsonError(null) }}
            placeholder='Paste mockup JSON: {"title": "...", "sections": [...]}'
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          />
          {jsonError && <p className="text-xs text-red-500 mt-1">{jsonError}</p>}
          <button
            onClick={handleAddMockupFromJson}
            disabled={!jsonInput.trim()}
            className="mt-1.5 flex items-center gap-1 text-sm text-brand-navy hover:text-brand-navy-light disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Add mockup
          </button>
        </div>
      )}

      {/* Live preview */}
      {preview && (
        <div className="mt-2">
          <WireframePreview mockup={preview} />
        </div>
      )}
    </div>
  )
}
