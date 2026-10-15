import { ImageResponse } from 'next/og'
import { HomeCard, OG_SIZE } from '@/lib/og/cards'
import { previewCopy } from '@/lib/og/preview-copy'

// French Open Graph card for /fr and /fr/about (overrides app/opengraph-image.tsx
// for this segment).
export const alt = previewCopy.fr.home.alt
export const size = OG_SIZE
export const contentType = 'image/png'

export default function FrenchOpengraphImage() {
  return new ImageResponse(<HomeCard locale="fr" />, size)
}
