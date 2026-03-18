import { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase/client'
import { signOut as firebaseSignOut } from 'firebase/auth'
import type { User } from 'firebase/auth'

interface AuthState {
  user: User | null
  loading: boolean
  error: Error | null
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(
      (firebaseUser) => {
        setAuthState({ user: firebaseUser, loading: false, error: null })
      },
      (error) => {
        setAuthState({ user: null, loading: false, error })
      }
    )
    return unsubscribe
  }, [])

  const signOut = async () => {
    try {
      await firebaseSignOut(auth)
    } catch (error) {
      setAuthState((prev) => ({ ...prev, error: error as Error }))
    }
  }

  return {
    ...authState,
    signOut,
    isAuthenticated: !!authState.user,
  }
}
