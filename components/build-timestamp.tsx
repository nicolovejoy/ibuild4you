'use client'

import { useEffect, useState } from 'react'

export function BuildTimestamp() {
  const [buildTime, setBuildTime] = useState<string | null>(null)

  useEffect(() => {
    import('@/lib/build-info.json')
      .then((mod) => setBuildTime(mod.buildTime))
      .catch(() => setBuildTime('Dev mode'))
  }, [])

  if (!buildTime) return null

  return (
    <span className="absolute -bottom-3.5 left-0 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
      {buildTime}
    </span>
  )
}
