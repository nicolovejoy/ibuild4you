// lib/hooks/useCoarsePointer.ts
'use client'

import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse)'

// True on touch screens (phones, tablets). Used by the chat composer to make
// Enter insert a newline instead of sending (#183). SSR-safe and tolerant of
// environments without matchMedia (old WebViews, bare jsdom): both report
// false, i.e. desktop behaviour.
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    setCoarse(mql.matches)
    const onChange = (e: { matches: boolean }) => setCoarse(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return coarse
}
