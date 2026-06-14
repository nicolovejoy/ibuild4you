'use client'

import { auth } from '@/lib/firebase/client'
import { signOut } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { User, LogOut, Shield, Info, Pencil, Check, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentUser, useUpdateCurrentUser } from '@/lib/query/hooks'

export function UserMenu() {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()
  const updateUser = useUpdateCurrentUser()
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

  const startEditingLabel = () => {
    setLabelDraft(currentUser?.account_label ?? '')
    setEditingLabel(true)
  }

  const saveLabel = () => {
    updateUser.mutate(
      { account_label: labelDraft.trim() },
      { onSuccess: () => setEditingLabel(false) }
    )
  }

  if (!user) return null

  // Always-visible identity: self-assigned label, else first name, else email prefix.
  const emailPrefix = user.email?.split('@')[0] ?? ''
  const displayName = currentUser?.account_label || currentUser?.first_name || emailPrefix

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-800 max-w-[160px]"
        title={user.email ?? undefined}
      >
        <User className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium truncate">{displayName}</span>
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
          <div className="absolute right-0 mt-2 w-60 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200 truncate">
              {user.email}
            </div>

            {/* Account label — self-assigned name to tell accounts apart */}
            <div className="px-4 py-2 border-b border-gray-200">
              {editingLabel ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveLabel()
                      if (e.key === 'Escape') setEditingLabel(false)
                    }}
                    placeholder="e.g. main, test"
                    maxLength={24}
                    className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-navy"
                  />
                  <button
                    onClick={saveLabel}
                    disabled={updateUser.isPending}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    aria-label="Save account name"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingLabel(false)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startEditingLabel}
                  className="w-full flex items-center justify-between gap-2 text-left group"
                >
                  <span className="text-xs text-gray-500">
                    Account name
                    {currentUser?.account_label ? (
                      <span className="block text-sm text-gray-800">
                        {currentUser.account_label}
                      </span>
                    ) : (
                      <span className="block text-sm text-gray-400 italic">Add a label</span>
                    )}
                  </span>
                  <Pencil className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 shrink-0" />
                </button>
              )}
            </div>

            <button
              onClick={() => {
                setShowDropdown(false)
                router.push('/about')
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <Info className="h-4 w-4" />
              About
            </button>
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
