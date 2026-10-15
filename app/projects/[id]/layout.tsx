import type { Metadata } from 'next'
import { briefPreviewMeta } from '@/lib/og/preview-copy'
import { resolveBriefPreview } from '@/lib/og/resolve-brief'
import { BriefLanguageHint } from '@/components/locale-context'
import { toLocale } from '@/lib/locale'

// Server layout for /projects/<slug-or-id>. Gives a shared brief
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

// Also hands the brief's language (nothing else) to the client, so a French
// maker opening their link signed out lands on a French sign-in page.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let language: unknown = null
  try {
    language = (await resolveBriefPreview(id))?.language
  } catch {
    language = null
  }
  return (
    <>
      {language ? <BriefLanguageHint language={toLocale(language)} /> : null}
      {children}
    </>
  )
}
