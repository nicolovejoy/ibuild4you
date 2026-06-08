import type { Metadata } from 'next'
import { Montserrat, Open_Sans } from 'next/font/google'
import './globals.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Providers } from './providers'

const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  weight: ['600', '700', '800'],
})

const openSans = Open_Sans({
  variable: '--font-open-sans',
  subsets: ['latin'],
})

const SITE_URL = 'https://ibuild4you.com'
const SITE_DESCRIPTION = 'AI-powered project intake — from idea to structured brief'

export const metadata: Metadata = {
  // metadataBase makes the generated opengraph-image emit an absolute https URL,
  // which link-preview scrapers (e.g. pianohouseproject.org) require.
  metadataBase: new URL(SITE_URL),
  title: process.env.NODE_ENV === 'development' ? '[DEV] iBuild4you' : 'iBuild4you',
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'iBuild4you',
    title: 'iBuild4you',
    description: SITE_DESCRIPTION,
    // og:image is supplied automatically from app/opengraph-image.tsx.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'iBuild4you',
    description: SITE_DESCRIPTION,
    // twitter:image is supplied automatically from app/opengraph-image.tsx.
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${montserrat.variable} ${openSans.variable} antialiased`}
      >
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  )
}
