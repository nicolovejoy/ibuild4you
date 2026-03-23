import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/__/auth/:path*',
        destination: 'https://ibuild4you-a0c4d.firebaseapp.com/__/auth/:path*',
      },
    ]
  },
}

export default nextConfig
