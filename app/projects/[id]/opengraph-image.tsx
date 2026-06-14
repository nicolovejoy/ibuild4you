import { ImageResponse } from 'next/og'
import { briefIdentity, type GlyphKey } from '@/lib/brief-identity'
import { getAdminDb } from '@/lib/firebase/admin'

// Per-brief Open Graph / link-preview card. Overrides the generic home-page card
// (app/opengraph-image.tsx) for /projects/<slug-or-id> links, giving each brief
// its own color + code + glyph so someone holding several brief links can tell
// them apart in their messages.
//
// ⚠️ PRIVACY: this route is UNAUTHENTICATED and its output is cached by link
// scrapers (iMessage, Slack, WhatsApp, …). Everything here is therefore
// effectively public to anyone with the link. We deliberately render ONLY the
// PII-free identity (derived from the random doc id) + a session count — never
// the title, requester name, or any brief contents.

export const alt = 'A brief on iBuild4you'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const runtime = 'nodejs' // Firebase Admin SDK needs Node, not Edge

const NAVY = '#1a3c6b'
const CREAM = '#f8f8f0'
const SLATE = '#4a6e91'

// Glyph shapes as SVG polygon point strings (100×100 viewBox). Same shape family
// as BriefBadge's lucide glyphs — consistency of *which* shape, not pixel-match.
const GLYPH_POINTS: Record<Exclude<GlyphKey, 'circle' | 'square'>, string> = {
  triangle: '50,4 89.8,73 10.2,73',
  diamond: '50,4 96,50 50,96 4,50',
  pentagon: '50,4 93.7,35.8 77,87.2 23,87.2 6.3,35.8',
  hexagon: '50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27',
  octagon: '67.6,7.5 92.5,32.4 92.5,67.6 67.6,92.5 32.4,92.5 7.5,67.6 7.5,32.4 32.4,7.5',
  star: '50,4 61.2,34.6 93.7,35.8 68.1,55.9 77,87.2 50,69 23,87.2 31.9,55.9 6.3,35.8 38.8,34.6',
}

function Glyph({ glyphKey, color, size: s }: { glyphKey: GlyphKey; color: string; size: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 100 100">
      {glyphKey === 'circle' ? (
        <circle cx="50" cy="50" r="46" fill={color} />
      ) : glyphKey === 'square' ? (
        <rect x="6" y="6" width="88" height="88" rx="10" fill={color} />
      ) : (
        <polygon points={GLYPH_POINTS[glyphKey]} fill={color} />
      )}
    </svg>
  )
}

// Resolve a slug-or-id param to the brief's doc id + session count. Returns null
// when not found so we fall back to the generic card.
async function resolveBrief(slugOrId: string): Promise<{ id: string; sessionCount: number } | null> {
  const db = getAdminDb()
  let id: string | null = null
  const bySlug = await db.collection('projects').where('slug', '==', slugOrId).limit(1).get()
  if (!bySlug.empty) {
    id = bySlug.docs[0].id
  } else {
    const byId = await db.collection('projects').doc(slugOrId).get()
    if (byId.exists) id = byId.id
  }
  if (!id) return null
  const sessions = await db.collection('sessions').where('project_id', '==', id).select().get()
  return { id, sessionCount: sessions.size }
}

export default async function BriefOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slugOrId } = await params
  let brief: { id: string; sessionCount: number } | null = null
  try {
    brief = await resolveBrief(slugOrId)
  } catch {
    brief = null // never let a DB hiccup break the scraper — fall back below
  }

  // Fallback: brief not found → generic brand card.
  if (!brief) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            background: CREAM,
            padding: '80px',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ fontSize: '76px', fontWeight: 800, color: NAVY, lineHeight: 1.05 }}>
            From an idea to a clear brief.
          </div>
          <div style={{ fontSize: '36px', color: SLATE, marginTop: '24px' }}>
            An AI guides you through the details — no technical knowledge needed.
          </div>
        </div>
      ),
      size,
    )
  }

  const { color, code, glyphKey } = briefIdentity(brief.id)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: CREAM,
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ width: '44px', height: '44px', border: `8px solid ${NAVY}`, borderRadius: '6px' }} />
              <div style={{ width: '44px', height: '44px', border: `8px solid ${NAVY}`, borderRadius: '6px' }} />
            </div>
            <div style={{ width: '98px', height: '14px', background: NAVY, borderRadius: '6px' }} />
          </div>
          <div style={{ fontSize: '40px', fontWeight: 700, color: SLATE }}>iBuild4you</div>
        </div>

        {/* Identity row — the per-brief part */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '200px',
              height: '200px',
              borderRadius: '32px',
              background: color,
            }}
          >
            <Glyph glyphKey={glyphKey} color={CREAM} size={104} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '40px', fontWeight: 700, color: NAVY }}>Your brief</div>
            <div style={{ fontSize: '88px', fontWeight: 800, color, letterSpacing: '4px', lineHeight: 1 }}>
              {code}
            </div>
          </div>
        </div>

        {/* Footer rule */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ width: '80px', height: '8px', background: color, borderRadius: '4px' }} />
          <div style={{ fontSize: '28px', color: SLATE, fontWeight: 600 }}>
            {brief.sessionCount > 0
              ? `${brief.sessionCount} conversation${brief.sessionCount === 1 ? '' : 's'} so far`
              : 'AI-powered project intake'}
          </div>
        </div>
      </div>
    ),
    size,
  )
}
