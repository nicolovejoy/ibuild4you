'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { copy } from '@/lib/copy'
import { openQuestionsMarkdown } from '@/lib/builder/open-questions'

// Maker-owned open risks, surfaced on the ferry desk (#220). Renders nothing
// when there are none. Copying writes no stamp.
export function OpenQuestionsCard({
  title,
  makerName,
  questions,
}: {
  title: string
  makerName: string
  questions: string[]
}) {
  const [copied, setCopied] = useState(false)
  if (questions.length === 0) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(openQuestionsMarkdown({ title, makerName, questions }))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-testid="open-questions" className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-brand-slate uppercase tracking-wide">
          {copy.brief.openQuestionsTitle(makerName)}
          {' '}
          <span className="text-gray-400 normal-case tracking-normal font-normal">
            ({questions.length})
          </span>
        </h3>
        <button
          type="button"
          data-testid="open-questions-copy"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? copy.brief.openQuestionsCopied : copy.brief.openQuestionsCopy}
        </button>
      </div>
      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-gray-700">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  )
}
