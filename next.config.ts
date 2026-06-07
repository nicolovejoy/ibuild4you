import type { NextConfig } from 'next'

// The Google OAuth handler is served same-origin (see lib/firebase/client.ts)
// by rewriting /__/auth/* to the Firebase project's auth domain. This must
// follow whichever project the build is wired to, otherwise preview deploys
// would route the sign-in handshake through prod. Vercel builds each
// environment with its own NEXT_PUBLIC_FIREBASE_PROJECT_ID, so deriving the
// destination here keeps preview self-contained. Defaults to prod.
const FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ibuild4you-a0c4d'

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/__/auth/:path*',
        destination: `https://${FIREBASE_PROJECT_ID}.firebaseapp.com/__/auth/:path*`,
      },
    ]
  },
}

export default nextConfig
