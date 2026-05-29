'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, Check } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'

// Shared layout for the two payload-reference pages under /about. Renders an
// intro, a copy-pastable annotated JSON descriptor, and a short notes list.
// The JSON descriptors mirror the schemas in lib/agent/new-project-prompt.ts
// and lib/agent/next-convo-prompt.ts — keep them in sync if those change.
export function PayloadDoc({
  title,
  endpoint,
  intro,
  json,
  notes,
}: {
  title: string
  endpoint: string
  intro: string
  json: string
  notes: string[]
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <SiteHeader />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16 space-y-8">
        <Link
          href="/about"
          className="inline-flex items-center gap-1 text-sm text-brand-slate hover:text-brand-navy"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to About
        </Link>

        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-brand-charcoal">{title}</h1>
          <p className="text-brand-slate leading-relaxed">{intro}</p>
          <p className="font-mono text-sm text-brand-navy">{endpoint}</p>
        </div>

        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-brand-cream hover:bg-white/20"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <pre className="overflow-x-auto rounded-xl bg-brand-charcoal p-4 text-xs leading-relaxed text-brand-cream">
            <code>{json}</code>
          </pre>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-brand-charcoal">Notes</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-brand-slate leading-relaxed">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
