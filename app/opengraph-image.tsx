import { ImageResponse } from 'next/og'

// Generated Open Graph / Twitter card for the home page. Next injects an
// absolute og:image / twitter:image pointing at this route (resolved against
// metadataBase in app/layout.tsx), so link-preview scrapers get a real image.
export const alt = 'iBuild4you — from idea to a clear brief'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const NAVY = '#1a3c6b'
const CREAM = '#f8f8f0'
const SLATE = '#4a6e91'

export default function OpengraphImage() {
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
        {/* Scaffold mark — a simple branded glyph built from bordered boxes */}
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

        {/* Headline + tagline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ fontSize: '76px', fontWeight: 800, color: NAVY, lineHeight: 1.05 }}>
            From an idea to a clear brief.
          </div>
          <div style={{ fontSize: '36px', color: SLATE, lineHeight: 1.3, maxWidth: '900px' }}>
            An AI guides you through the details — no technical knowledge needed.
          </div>
        </div>

        {/* Footer rule */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ width: '80px', height: '8px', background: NAVY, borderRadius: '4px' }} />
          <div style={{ fontSize: '28px', color: SLATE, fontWeight: 600 }}>AI-powered project intake</div>
        </div>
      </div>
    ),
    size,
  )
}
