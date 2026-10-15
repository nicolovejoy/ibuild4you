import type { Metadata } from 'next'
import { previewCopy } from '@/lib/og/preview-copy'

// French share metadata for every page under /fr. Without this, the French pages
// inherit the English title/description/locale from app/layout.tsx and a shared
// /fr link previews in English. og:image comes from app/fr/opengraph-image.tsx.
const fr = previewCopy.fr

export const metadata: Metadata = {
  description: fr.siteDescription,
  openGraph: {
    type: 'website',
    siteName: 'iBuild4you',
    title: 'iBuild4you',
    description: fr.siteDescription,
    locale: fr.ogLocale,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'iBuild4you',
    description: fr.siteDescription,
  },
}

export default function FrenchLayout({ children }: { children: React.ReactNode }) {
  return children
}
