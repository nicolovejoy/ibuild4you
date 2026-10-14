import { ImageResponse } from 'next/og'
import { briefIdentity } from '@/lib/brief-identity'
import { BriefCard, HomeCard, OG_SIZE } from '@/lib/og/cards'
import { conversationsLine, previewCopy } from '@/lib/og/preview-copy'
import { resolveBriefPreview, type BriefPreview } from '@/lib/og/resolve-brief'
import { toLocale } from '@/lib/locale'

// Per-brief Open Graph / link-preview card. Overrides the generic home-page card
// (app/opengraph-image.tsx) for /projects/<slug-or-id> links, giving each brief
// its own color + code + glyph so someone holding several brief links can tell
// them apart in their messages. Text is in the brief's language.
//
// ⚠️ PRIVACY: this route is UNAUTHENTICATED and its output is cached by link
// scrapers (iMessage, Slack, WhatsApp, …). Everything here is therefore
// effectively public to anyone with the link. We render the brief TITLE (unless
// the builder ticked hide_title_in_previews — the slug in the URL is already
// derived from it), the PII-free identity and a session count — never the
// requester name or any brief contents.

// Static alt (English): a per-brief alt would need generateImageMetadata, which
// changes the image URL. Low value — the card itself carries the language.
export const alt = previewCopy.en.brief.alt
export const size = OG_SIZE
export const contentType = 'image/png'
export const runtime = 'nodejs' // Firebase Admin SDK needs Node, not Edge

export default async function BriefOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slugOrId } = await params
  let brief: BriefPreview | null = null
  try {
    brief = await resolveBriefPreview(slugOrId, { withSessionCount: true })
  } catch {
    brief = null // never let a DB hiccup break the scraper — fall back below
  }

  // Fallback: brief not found → generic brand card.
  if (!brief) return new ImageResponse(<HomeCard locale="en" />, size)

  const locale = toLocale(brief.language)
  const { color, code, glyphKey } = briefIdentity(brief.id)
  const title = !brief.hideTitle && brief.title?.trim() ? brief.title : null

  return new ImageResponse(
    <BriefCard
      locale={locale}
      title={title}
      color={color}
      code={code}
      glyphKey={glyphKey}
      footer={conversationsLine(locale, brief.sessionCount)}
    />,
    size,
  )
}
