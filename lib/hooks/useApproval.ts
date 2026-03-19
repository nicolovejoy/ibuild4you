import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useAuth } from './useAuth'

export function useApproval() {
  const { user, loading: authLoading } = useAuth()
  const [approved, setApproved] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function check() {
      try {
        const res = await apiFetch('/api/approved-emails')
        if (!res.ok) throw new Error('Failed to check approval')
        const data = await res.json()
        if (!cancelled) {
          setApproved(data.approved)
        }
      } catch {
        if (!cancelled) {
          setApproved(false)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  return { approved, loading: authLoading || loading }
}
