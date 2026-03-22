'use client'

import { WireframePreview } from './WireframePreview'
import type { WireframeMockup } from '@/lib/types'

// A segment is either plain text or a wireframe JSON block.
export type Segment =
  | { type: 'text'; content: string }
  | { type: 'wireframe'; raw: string; parsed: WireframeMockup | null }

// Split message content into text and wireframe segments.
//
// How it works:
// 1. We look for complete ```wireframe ... ``` fenced blocks using a regex
// 2. Everything between/around those blocks is plain text
// 3. For each wireframe block, we try to parse the JSON inside
// 4. If the JSON is bad, parsed is null → we'll show fallback text
// 5. If there's an opening ```wireframe without a closing ```, that's a
//    streaming-in-progress block → we flag it so the UI can show a hint
//
export function parseMessageContent(content: string): { segments: Segment[]; hasIncompleteBlock: boolean } {
  if (!content) return { segments: [], hasIncompleteBlock: false }

  // Match complete ```wireframe\n...\n``` blocks
  const fencePattern = /```wireframe\n([\s\S]*?)```/g
  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of content.matchAll(fencePattern)) {
    // Text before this block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text.trim()) segments.push({ type: 'text', content: text })
    }

    // The wireframe block — try to parse the JSON inside the fences
    const json = match[1].trim()
    let parsed: WireframeMockup | null = null
    try {
      const obj = JSON.parse(json)
      // Basic validation: must have title and sections array
      if (obj && typeof obj.title === 'string' && Array.isArray(obj.sections)) {
        parsed = obj as WireframeMockup
      }
    } catch {
      // Bad JSON — parsed stays null, we'll show raw fallback
    }
    segments.push({ type: 'wireframe', raw: json, parsed })

    lastIndex = match.index + match[0].length
  }

  // Remaining text after the last block
  const remaining = content.slice(lastIndex)

  // Check if there's an unclosed ```wireframe (agent still streaming the block)
  const incompleteMatch = remaining.match(/```wireframe\n[\s\S]*$/)
  if (incompleteMatch) {
    // Text before the incomplete block
    const textBefore = remaining.slice(0, incompleteMatch.index)
    if (textBefore.trim()) segments.push({ type: 'text', content: textBefore })
    return { segments, hasIncompleteBlock: true }
  }

  if (remaining.trim()) segments.push({ type: 'text', content: remaining })
  return { segments, hasIncompleteBlock: false }
}

// Render message content, replacing wireframe blocks with visual previews.
export function MessageContent({ content, className }: { content: string; className?: string }) {
  const { segments, hasIncompleteBlock } = parseMessageContent(content)

  // No wireframe blocks at all — fast path, render as plain text
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
        <p className="text-xs text-gray-400 italic mt-1 animate-pulse">Drawing layout...</p>
      )}
    </div>
  )
}
