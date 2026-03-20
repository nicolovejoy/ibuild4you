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

export const metadata: Metadata = {
  title: process.env.NODE_ENV === 'development' ? '[DEV] iBuild4you' : 'iBuild4you',
  description: 'AI-powered project intake — from idea to structured brief',
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
