import type { Metadata } from 'next'
import { briefPreviewMeta } from '@/lib/og/preview-copy'
import { resolveBriefPreview } from '@/lib/og/resolve-brief'

// Server layout for /projects/<slug-or-id>: only here to give a shared brief
// link its own share title/description in the brief's language (the page itself
// is a client component and can't export metadata). The card image comes from
// ./opengraph-image.tsx. Same privacy rules as that route — title (unless hidden),
// never names or brief contents.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  let brief = null
  try {
    brief = await resolveBriefPreview(id)
  } catch {
    brief = null // a DB hiccup keeps the site-wide metadata from app/layout.tsx
  }
  if (!brief) return {}

  const meta = briefPreviewMeta(brief)
  return {
    openGraph: {
      type: 'website',
      siteName: 'iBuild4you',
      title: meta.title,
      description: meta.description,
      locale: meta.ogLocale,
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
    },
  }
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return children
}
