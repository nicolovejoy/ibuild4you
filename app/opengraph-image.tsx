import { ImageResponse } from 'next/og'
import { HomeCard, OG_SIZE } from '@/lib/og/cards'
import { previewCopy } from '@/lib/og/preview-copy'

// Generated Open Graph / Twitter card for the home page. Next injects an
// absolute og:image / twitter:image pointing at this route (resolved against
// metadataBase in app/layout.tsx), so link-preview scrapers get a real image.
// The French pages use app/fr/opengraph-image.tsx.
export const alt = previewCopy.en.home.alt
export const size = OG_SIZE
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(<HomeCard locale="en" />, size)
}
