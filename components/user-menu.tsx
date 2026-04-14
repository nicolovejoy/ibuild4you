'use client'

import { auth } from '@/lib/firebase/client'
import { signOut } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { User, LogOut, Shield } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/lib/query/hooks'

export function UserMenu() {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser)
    })
    return unsubscribe
  }, [])

  const handleSignOut = async () => {
    queryClient.clear()
    await signOut(auth)
    router.push('/')
    router.refresh()
  }

  if (!user) return null

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="p-2 rounded-md hover:bg-gray-100"
      >
        <User className="h-5 w-5 text-gray-800" />
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200">
              {user.email}
            </div>
            {isAdmin && (
              <button
                onClick={() => {
                  setShowDropdown(false)
                  router.push('/admin')
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
              >
                <Shield className="h-4 w-4" />
                Admin
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
