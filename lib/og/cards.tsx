import type { GlyphKey } from '@/lib/brief-identity'
import type { Locale } from '@/lib/locale'
import { previewCopy, truncateTitle } from './preview-copy'

// JSX for the Open Graph cards, rendered by next/og's ImageResponse (Satori:
// flexbox only, every multi-child div needs display:flex). Shared by the home
// card (app/opengraph-image.tsx, app/fr/opengraph-image.tsx) and the per-brief
// card (app/projects/[id]/opengraph-image.tsx).

export const OG_SIZE = { width: 1200, height: 630 }

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

function Glyph({ glyphKey, color, size }: { glyphKey: GlyphKey; color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
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

// Scaffold mark — a simple branded glyph built from bordered boxes.
function BrandRow() {
  return (
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
  )
}

function FooterRule({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      <div style={{ width: '80px', height: '8px', background: color, borderRadius: '4px' }} />
      <div style={{ fontSize: '28px', color: SLATE, fontWeight: 600 }}>{text}</div>
    </div>
  )
}

const frame = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
  justifyContent: 'space-between',
  background: CREAM,
  padding: '80px',
  fontFamily: 'sans-serif',
}

/** The generic brand card, in English or French. */
export function HomeCard({ locale }: { locale: Locale }) {
  const c = previewCopy[locale].home
  return (
    <div style={frame}>
      <BrandRow />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ fontSize: '76px', fontWeight: 800, color: NAVY, lineHeight: 1.05 }}>{c.headline}</div>
        <div style={{ fontSize: '36px', color: SLATE, lineHeight: 1.3, maxWidth: '900px' }}>{c.sub}</div>
      </div>
      <FooterRule color={NAVY} text={c.footer} />
    </div>
  )
}

/**
 * A brief's card: colour + glyph + code from its random id, plus its title
 * unless hidden (then the code is the headline, as before titles were shown).
 */
export function BriefCard({
  locale,
  title,
  color,
  code,
  glyphKey,
  footer,
}: {
  locale: Locale
  title: string | null
  color: string
  code: string
  glyphKey: GlyphKey
  footer: string
}) {
  const c = previewCopy[locale].brief
  const shown = title ? truncateTitle(title) : null
  // Long titles wrap to two lines at a smaller size.
  const titleSize = shown && shown.length > 32 ? '60px' : '76px'
  return (
    <div style={frame}>
      <BrandRow />
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: '200px',
            height: '200px',
            borderRadius: '32px',
            background: color,
          }}
        >
          <Glyph glyphKey={glyphKey} color={CREAM} size={104} />
        </div>
        {shown ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '780px' }}>
            <div style={{ display: 'flex', gap: '14px', fontSize: '32px', fontWeight: 700, color: SLATE }}>
              <span>{c.label}</span>
              <span>·</span>
              <span style={{ color, letterSpacing: '2px' }}>{code}</span>
            </div>
            <div style={{ fontSize: titleSize, fontWeight: 800, color: NAVY, lineHeight: 1.08 }}>{shown}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '40px', fontWeight: 700, color: NAVY }}>{c.label}</div>
            <div style={{ fontSize: '88px', fontWeight: 800, color, letterSpacing: '4px', lineHeight: 1 }}>{code}</div>
          </div>
        )}
      </div>
      <FooterRule color={color} text={footer} />
    </div>
  )
}
