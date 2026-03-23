import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Navigate to a parent route when Escape is pressed.
// Skips if the user is typing in an input/textarea/select or a modal is open.
export function useEscapeBack(path: string) {
  const router = useRouter()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return

      // Don't navigate if typing in a form field
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Don't navigate if a modal is open (modal has role="dialog" or data-modal)
      if (document.querySelector('[role="dialog"]')) return

      router.push(path)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [path, router])
}
