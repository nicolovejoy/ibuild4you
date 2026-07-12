'use client'

import { WireframePreview } from './WireframePreview'
import type { WireframeMockup } from '@/lib/types'

// A segment is plain text, a wireframe JSON block, or an options block (#131).
export type Segment =
  | { type: 'text'; content: string }
  | { type: 'wireframe'; raw: string; parsed: WireframeMockup | null }
  | { type: 'options'; raw: string; parsed: string[] | null }

// Split message content into text, wireframe, and options segments.
//
// How it works:
// 1. We look for complete ```wireframe ... ``` and ```options ... ``` fenced
//    blocks using a regex
// 2. Everything between/around those blocks is plain text
// 3. For each block, we try to parse the JSON inside
// 4. If the JSON is bad, parsed is null → we'll show fallback text
// 5. If there's an opening fence without a closing ```, that's a
//    streaming-in-progress block → we flag it so the UI can show a hint
//
export function parseMessageContent(content: string): {
  segments: Segment[]
  hasIncompleteBlock: boolean
  incompleteKind?: 'wireframe' | 'options'
} {
  if (!content) return { segments: [], hasIncompleteBlock: false }

  // Match complete ```wireframe\n...\n``` and ```options\n...\n``` blocks
  const fencePattern = /```(wireframe|options)\n([\s\S]*?)```/g
  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of content.matchAll(fencePattern)) {
    // Text before this block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text.trim()) segments.push({ type: 'text', content: text })
    }

    const kind = match[1] as 'wireframe' | 'options'
    const json = match[2].trim()
    if (kind === 'wireframe') {
      segments.push({ type: 'wireframe', raw: json, parsed: parseWireframe(json) })
    } else {
      segments.push({ type: 'options', raw: json, parsed: parseOptions(json) })
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text after the last block
  const remaining = content.slice(lastIndex)

  // Check if there's an unclosed fence (agent still streaming the block)
  const incompleteMatch = remaining.match(/```(wireframe|options)\n[\s\S]*$/)
  if (incompleteMatch) {
    // Text before the incomplete block
    const textBefore = remaining.slice(0, incompleteMatch.index)
    if (textBefore.trim()) segments.push({ type: 'text', content: textBefore })
    return { segments, hasIncompleteBlock: true, incompleteKind: incompleteMatch[1] as 'wireframe' | 'options' }
  }

  if (remaining.trim()) segments.push({ type: 'text', content: remaining })
  return { segments, hasIncompleteBlock: false }
}

function parseWireframe(json: string): WireframeMockup | null {
  try {
    const obj = JSON.parse(json)
    // Basic validation: must have title and sections array
    if (obj && typeof obj.title === 'string' && Array.isArray(obj.sections)) {
      return obj as WireframeMockup
    }
  } catch {
    // Bad JSON — fall through to null, we'll show raw fallback
  }
  return null
}

// An options block is a JSON array of short, non-empty strings.
function parseOptions(json: string): string[] | null {
  try {
    const arr = JSON.parse(json)
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.every((o) => typeof o === 'string' && o.trim().length > 0)
    ) {
      return arr as string[]
    }
  } catch {
    // Bad JSON — fall through to null, we'll show raw fallback
  }
  return null
}

// Render message content, replacing wireframe blocks with visual previews and
// options blocks with choice chips. When onOptionSelect is provided the chips
// are tappable (maker chat, newest message); without it they render as a
// static, muted list (transcripts, older messages).
export function MessageContent({
  content,
  className,
  onOptionSelect,
}: {
  content: string
  className?: string
  onOptionSelect?: (option: string) => void
}) {
  const { segments, hasIncompleteBlock, incompleteKind } = parseMessageContent(content)

  // No fenced blocks at all — fast path, render as plain text
  if (segments.length <= 1 && segments[0]?.type === 'text' && !hasIncompleteBlock) {
    return <p className={className || 'whitespace-pre-wrap text-sm leading-relaxed'}>{content}</p>
  }

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <p key={i} className={className || 'whitespace-pre-wrap text-sm leading-relaxed'}>
              {seg.content}
            </p>
          )
        }
        if (seg.type === 'options') {
          if (seg.parsed) {
            return <OptionChips key={i} options={seg.parsed} onSelect={onOptionSelect} />
          }
          // Malformed block — hide it rather than show raw JSON to a maker;
          // the surrounding question text still reads fine without chips.
          return null
        }
        // Wireframe segment
        if (seg.parsed) {
          return <WireframePreview key={i} mockup={seg.parsed} />
        }
        // Malformed JSON — show raw text so nothing is lost
        return (
          <pre key={i} className="text-xs bg-gray-100 p-2 rounded overflow-x-auto my-2 text-gray-600">
            {seg.raw}
          </pre>
        )
      })}
      {hasIncompleteBlock && (
        <p className="text-xs text-gray-400 italic mt-1 animate-pulse">
          {incompleteKind === 'wireframe' ? 'Drawing layout...' : '…'}
        </p>
      )}
    </div>
  )
}

function OptionChips({ options, onSelect }: { options: string[]; onSelect?: (option: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {options.map((option, i) =>
        onSelect ? (
          <button
            key={i}
            onClick={() => onSelect(option)}
            className="px-3 py-1.5 text-sm rounded-full border border-brand-navy/30 text-brand-navy bg-white hover:bg-brand-navy hover:text-white transition-colors"
          >
            {option}
          </button>
        ) : (
          <span
            key={i}
            className="px-3 py-1.5 text-sm rounded-full border border-gray-200 text-gray-500 bg-gray-50"
          >
            {option}
          </span>
        ),
      )}
    </div>
  )
}
