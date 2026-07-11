'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X, Lock, Code2, LayoutList, Check, Copy, Pencil } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Skeleton } from '@/components/ui/Skeleton'
import { useUpdateBrief } from '@/lib/query/hooks'
import { parseBriefJson, serializeBriefContent, emptyBrief } from '@/lib/api/brief-json'
import { lockedFirst } from '@/lib/api/brief-merge'
import type { BriefContent, BriefDecision } from '@/lib/types'

// Brief-as-document editor (#19 Phase 3). Read-first: the brief renders as a
// calm document by default; "Edit brief" enters an explicit edit mode with two
// views over one BriefContent — a structured form and a raw-JSON view (the
// cost-routing ferry's paste target/source) — and Save/Cancel return to the
// read view. One Save for the whole document.

type EditView = 'structured' | 'raw'

const hasAnyContent = (b: BriefContent): boolean =>
  !!(b.problem || b.target_users || b.constraints || b.additional_context ||
    (b.features && b.features.length) || (b.decisions && b.decisions.length) ||
    (b.open_risks && b.open_risks.length))

export function BriefEditor({
  projectId,
  content,
  version,
  loading = false,
}: {
  projectId: string
  content: BriefContent | undefined
  // Bumps when the brief is replaced from outside (save, regen, import) so the
  // editor re-seeds its working copy instead of clobbering the fresh data.
  version: number | undefined
  // The brief query is still in flight — show a skeleton, not "no brief yet"
  // (which would mislead while a populated brief loads).
  loading?: boolean
}) {
  const base = content && Object.keys(content).length > 0 ? content : emptyBrief()
  const updateBrief = useUpdateBrief()

  // Read-first: the brief renders as a calm document by default; editing is an
  // explicit mode you enter and leave (Nico's feedback — the always-on form was
  // the clunk). 'view' = read; 'edit' = the structured/raw editor.
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editView, setEditView] = useState<EditView>('structured')
  const [draft, setDraft] = useState<BriefContent>(base)
  const [rawText, setRawText] = useState<string>(() => serializeBriefContent(base))
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Collapsed-by-default read view (Nico 2026-07-11): a mature brief is a wall
  // of text; show the first few lines with a fade + "Show full brief". Only
  // offer the toggle when the content actually overflows the clamp.
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const readRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) return // keep the last measurement so "Show less" stays offered
    const el = readRef.current
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 4)
  }, [expanded, version, mode, content])

  // Re-seed both working copies whenever the underlying brief changes (version
  // bump) and drop back to read mode — an external update (regen/import) lands
  // you on the fresh document, not a stale edit form.
  useEffect(() => {
    setDraft(base)
    setRawText(serializeBriefContent(base))
    setError(null)
    setMode('view')
    setExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const enterEdit = () => {
    setDraft(base)
    setRawText(serializeBriefContent(base))
    setError(null)
    setEditView('structured')
    setMode('edit')
  }

  const cancelEdit = () => {
    // Discard the working copy and return to the read view.
    setDraft(base)
    setRawText(serializeBriefContent(base))
    setError(null)
    setMode('view')
  }

  const switchTo = (next: EditView) => {
    if (next === editView) return
    if (next === 'raw') {
      setRawText(serializeBriefContent(draft))
      setError(null)
      setEditView('raw')
    } else {
      const r = parseBriefJson(rawText)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setDraft(r.value)
      setError(null)
      setEditView('structured')
    }
  }

  const handleSave = async () => {
    let toSave: BriefContent
    if (editView === 'raw') {
      const r = parseBriefJson(rawText)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toSave = r.value
      setDraft(r.value)
    } else {
      toSave = draft
    }
    setError(null)
    await updateBrief.mutateAsync({ project_id: projectId, content: toSave })
    setMode('view') // saved — back to the read view
  }

  const copyRaw = async () => {
    await navigator.clipboard.writeText(
      editView === 'raw' ? rawText : serializeBriefContent(draft),
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // --- Read view (default) ---
  if (mode === 'view') {
    return (
      <Card hover={false}>
        <CardBody>
          <div className="flex justify-end mb-1">
            <button
              onClick={enterEdit}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit brief
            </button>
          </div>
          {hasAnyContent(base) ? (
            <>
              <div ref={readRef} className={expanded ? undefined : 'relative max-h-28 overflow-hidden'}>
                <BriefReadView content={base} />
                {!expanded && overflowing && (
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                )}
              </div>
              {(overflowing || expanded) && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-2 text-xs font-medium text-brand-navy hover:underline"
                >
                  {expanded ? 'Show less' : 'Show full brief'}
                </button>
              )}
            </>
          ) : loading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-4 w-1/2 rounded" />
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 mb-3">No brief details yet.</p>
              <LoadingButton variant="secondary" size="sm" icon={Pencil} onClick={enterEdit}>
                Add brief details
              </LoadingButton>
            </div>
          )}
        </CardBody>
      </Card>
    )
  }

  // --- Edit mode ---
  return (
    <Card hover={false}>
      <CardBody>
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 text-xs">
            <button
              onClick={() => switchTo('structured')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded ${editView === 'structured' ? 'bg-brand-navy text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <LayoutList className="h-3.5 w-3.5" /> Structured
            </button>
            <button
              onClick={() => switchTo('raw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded ${editView === 'raw' ? 'bg-brand-navy text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <Code2 className="h-3.5 w-3.5" /> Raw JSON
            </button>
          </div>
          <button
            onClick={copyRaw}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
            title="Copy the brief as JSON (paste target/source for the ferry)"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        </div>

        {editView === 'structured' ? (
          <StructuredEditor draft={draft} onChange={setDraft} />
        ) : (
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value)
              setError(null)
            }}
            rows={20}
            spellCheck={false}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          />
        )}

        {error && <div className="mt-3"><StatusMessage type="error" message={error} /></div>}

        <div className="mt-4 flex items-center gap-3 pt-3 border-t border-gray-100">
          <LoadingButton
            variant="primary"
            size="sm"
            loading={updateBrief.isPending}
            loadingText="Saving…"
            onClick={handleSave}
          >
            Save brief
          </LoadingButton>
          <button
            onClick={cancelEdit}
            disabled={updateBrief.isPending}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          {updateBrief.error && <span className="text-xs text-red-500">{updateBrief.error.message}</span>}
        </div>
      </CardBody>
    </Card>
  )
}

// --- Read view: the brief as a calm document (empty sections hidden) ---

function BriefReadView({ content }: { content: BriefContent }) {
  const prose = [
    { label: 'Problem', value: content.problem },
    { label: 'Target users', value: content.target_users },
    { label: 'Constraints', value: content.constraints },
    { label: 'Additional context', value: content.additional_context },
  ].filter((s) => s.value)
  const features = content.features || []
  const decisions = lockedFirst(content.decisions)
  const openRisks = content.open_risks || []

  return (
    <div className="space-y-4 mt-2">
      {prose.map((s) => (
        <Section key={s.label} label={s.label}>
          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{s.value}</p>
        </Section>
      ))}
      {features.length > 0 && (
        <Section label="Features">
          <ul className="list-disc list-inside space-y-1">
            {features.map((f, i) => <li key={i} className="text-gray-800 text-sm">{f}</li>)}
          </ul>
        </Section>
      )}
      {decisions.length > 0 && (
        <Section label="Decisions">
          <ul className="space-y-2">
            {decisions.map((d, i) => (
              <li key={i} className="text-sm">
                {d.locked && (
                  <span
                    className="inline-flex items-center gap-0.5 mr-1.5 px-1 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wide align-middle"
                    title="Durable constraint — the agent reconciles against it instead of silently overwriting"
                  >
                    <Lock className="h-2.5 w-2.5" aria-hidden /> Locked
                  </span>
                )}
                <span className="font-medium text-gray-900">{d.topic}:</span>{' '}
                <span className="text-gray-700">{d.decision}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {openRisks.length > 0 && (
        <Section label="Open risks">
          <ul className="list-disc list-inside space-y-1">
            {openRisks.map((r, i) => <li key={i} className="text-gray-800 text-sm">{r}</li>)}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-brand-slate uppercase tracking-wide mb-1.5">{label}</h3>
      {children}
    </div>
  )
}

// --- Structured form over BriefContent ---

function StructuredEditor({
  draft,
  onChange,
}: {
  draft: BriefContent
  onChange: (b: BriefContent) => void
}) {
  const set = (patch: Partial<BriefContent>) => onChange({ ...draft, ...patch })

  return (
    <div className="space-y-5">
      <ProseField label="Problem" value={draft.problem} onChange={(v) => set({ problem: v })} />
      <ProseField label="Target users" value={draft.target_users} onChange={(v) => set({ target_users: v })} />
      <StringListField
        label="Features"
        items={draft.features || []}
        onChange={(features) => set({ features })}
        placeholder="Add a feature…"
      />
      <ProseField label="Constraints" value={draft.constraints} onChange={(v) => set({ constraints: v })} />
      <DecisionsField
        decisions={draft.decisions || []}
        onChange={(decisions) => set({ decisions })}
      />
      <StringListField
        label="Open risks"
        items={draft.open_risks || []}
        onChange={(open_risks) => set({ open_risks })}
        placeholder="Add an open risk…"
      />
      <ProseField
        label="Additional context"
        value={draft.additional_context}
        onChange={(v) => set({ additional_context: v })}
      />
    </div>
  )
}

function ProseField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-brand-slate uppercase tracking-wide block mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
      />
    </div>
  )
}

function StringListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
}) {
  const [adding, setAdding] = useState('')
  const add = () => {
    if (!adding.trim()) return
    onChange([...items, adding.trim()])
    setAdding('')
  }
  return (
    <div>
      <label className="text-xs font-semibold text-brand-slate uppercase tracking-wide block mb-1.5">{label}</label>
      {items.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
              />
              <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
        />
        <button onClick={add} disabled={!adding.trim()} className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function DecisionsField({
  decisions,
  onChange,
}: {
  decisions: BriefDecision[]
  onChange: (d: BriefDecision[]) => void
}) {
  // Locked-first so durable constraints lead (#71). Edit in place against the
  // displayed order; map back to the same objects on change.
  const ordered = lockedFirst(decisions)
  const update = (i: number, patch: Partial<BriefDecision>) =>
    onChange(ordered.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  return (
    <div>
      <label className="text-xs font-semibold text-brand-slate uppercase tracking-wide block mb-1.5">Decisions</label>
      {ordered.length > 0 && (
        <ul className="space-y-2 mb-2">
          {ordered.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <button
                onClick={() => update(i, { locked: !d.locked })}
                title={
                  d.locked
                    ? 'Locked — a durable constraint the agent reconciles against instead of silently overwriting. Click to unlock.'
                    : 'Click to lock — makes this a durable constraint the agent must reconcile against (#71).'
                }
                className={`mt-1 p-1 rounded shrink-0 ${d.locked ? 'bg-amber-100 text-amber-700' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
              >
                <Lock className="h-3.5 w-3.5" />
              </button>
              <div className="flex-1 space-y-1">
                <input
                  value={d.topic}
                  onChange={(e) => update(i, { topic: e.target.value })}
                  placeholder="Topic (e.g. Payment)"
                  className="w-full px-2.5 py-1 border border-gray-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-navy"
                />
                <input
                  value={d.decision}
                  onChange={(e) => update(i, { decision: e.target.value })}
                  placeholder="Decision (e.g. Stripe only)"
                  className="w-full px-2.5 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
                />
              </div>
              <button onClick={() => onChange(ordered.filter((_, idx) => idx !== i))} className="mt-1 p-1 text-gray-400 hover:text-red-500 shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => onChange([...ordered, { topic: '', decision: '' }])}
        className="flex items-center gap-1.5 text-xs text-brand-navy hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add decision
      </button>
    </div>
  )
}
