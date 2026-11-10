'use client'

import { MessageContent } from '@/components/ui/MessageContent'
import { publicCopy, type Locale } from '@/lib/copy-public'
import type { HeroScript } from '@/lib/public/hero-script'

// The conversation half of the home-page demo. Bubble styling mirrors the
// maker chat in MakerProjectView (navy for the maker, white for Sam). Every
// turn is always in the DOM so the panel's height never changes; turns past
// `shown` are hidden, not absent.
export function HeroChat({
  script,
  locale,
  shown,
  onComposerClick,
  className,
}: {
  script: HeroScript
  locale: Locale
  shown: number
  onComposerClick: () => void
  className?: string
}) {
  const t = publicCopy[locale].home
  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 hero-label border-b border-(--h-line) text-[11px] uppercase text-(--h-muted) font-semibold">
        <span className="shrink-0">{t.conversationLabel(script.brief.conversation)}</span>
        <span className="min-w-0 truncate text-(--h-faint) normal-case tracking-normal font-normal">
          {script.brief.title}
        </span>
      </div>
      <ol className="flex-1 space-y-3 p-4" aria-live="polite">
        {script.turns.map((turn, i) => {
          const visible = i < shown
          const maker = turn.role === 'maker'
          return (
            <li
              key={i}
              className={`flex ${maker ? 'justify-end' : 'justify-start'} transition-all duration-500 motion-reduce:transition-none ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
              }`}
              aria-hidden={!visible}
            >
              <div
                className={`hero-bubble max-w-[85%] px-4 py-2.5 ${
                  maker
                    ? 'bg-(--h-maker-bg) text-(--h-maker-fg)'
                    : 'bg-(--h-agent-bg) border border-(--h-agent-border) text-(--h-agent-fg)'
                }`}
              >
                <p
                  className={`text-[10px] mb-1 ${maker ? 'text-(--h-maker-meta)' : 'text-(--h-faint)'}`}
                >
                  {maker ? script.makerName : t.agentLabel}
                </p>
                <MessageContent content={turn.text} />
              </div>
            </li>
          )
        })}
      </ol>
      {/* The composer is the page's call to action in disguise: it looks like
          the real chat box and takes the visitor to the interest form. */}
      <div className="border-t border-(--h-line) p-3">
        <button
          type="button"
          onClick={onComposerClick}
          className="hero-bubble w-full flex items-center justify-between gap-3 border border-(--h-line-input) bg-(--h-surface) px-3 py-2 text-left text-sm text-(--h-faint) hover:border-(--h-ink) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink)"
        >
          <span>{t.composerPlaceholder}</span>
          <span
            className="hero-bubble inline-flex h-7 w-7 items-center justify-center bg-(--h-send-bg) text-(--h-send-fg)"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22 11 13 2 9z" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}
