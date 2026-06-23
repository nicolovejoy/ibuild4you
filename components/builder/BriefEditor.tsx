'use client'

import { useEffect, useState } from 'react'
import { Plus, X, Lock, Code2, LayoutList, Check, Copy } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useUpdateBrief } from '@/lib/query/hooks'
import { parseBriefJson, serializeBriefContent, emptyBrief } from '@/lib/api/brief-json'
import { lockedFirst } from '@/lib/api/brief-merge'
import type { BriefContent, BriefDecision } from '@/lib/types'

// Brief-as-document editor (#19 Phase 3). One BriefContent document, two views
// over the same data: a structured form (default, safe for non-technical
// builders) and a raw-JSON view (the cost-routing ferry's paste target/source).
// One Save for the whole document. Replaces the old read-only BriefView in the
// builder Brief tab.

type View = 'structured' | 'raw'

export function BriefEditor({
  projectId,
  content,
  version,
}: {
  projectId: string
  content: BriefContent | undefined
  // Bumps when the brief is replaced from outside (save, regen, import) so the
  // editor re-seeds its working copy instead of clobbering the fresh data.
  version: number | undefined
}) {
  const base = content && Object.keys(content).length > 0 ? content : emptyBrief()
  const updateBrief = useUpdateBrief()

  const [view, setView] = useState<View>('structured')
  const [draft, setDraft] = useState<BriefContent>(base)
  const [rawText, setRawText] = useState<string>(() => serializeBriefContent(base))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // Re-seed both working copies whenever the underlying brief changes (version
  // bump). Keeps manual edits while you're working, adopts external updates.
  useEffect(() => {
    setDraft(base)
    setRawText(serializeBriefContent(base))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const switchTo = (next: View) => {
    if (next === view) return
    if (next === 'raw') {
      // Serialize current structured edits into the raw view.
      setRawText(serializeBriefContent(draft))
      setError(null)
      setView('raw')
    } else {
      // Parse raw edits back into the structured form; block on invalid JSON.
      const r = parseBriefJson(rawText)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setDraft(r.value)
      setError(null)
      setView('structured')
    }
  }

  const handleSave = async () => {
    let toSave: BriefContent
    if (view === 'raw') {
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
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const copyRaw = async () => {
    await navigator.clipboard.writeText(
      view === 'raw' ? rawText : serializeBriefContent(draft),
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card hover={false}>
      <CardBody>
        <div className="flex items-center justify-between mb-4">
          {/* View toggle */}
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 text-xs">
            <button
              onClick={() => switchTo('structured')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded ${view === 'structured' ? 'bg-brand-navy text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <LayoutList className="h-3.5 w-3.5" /> Structured
            </button>
            <button
              onClick={() => switchTo('raw')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded ${view === 'raw' ? 'bg-brand-navy text-white' : 'text-gray-600 hover:bg-gray-100'}`}
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

        {view === 'structured' ? (
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
            {saved ? 'Saved!' : 'Save brief'}
          </LoadingButton>
          {updateBrief.error && <span className="text-xs text-red-500">{updateBrief.error.message}</span>}
        </div>
      </CardBody>
    </Card>
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
