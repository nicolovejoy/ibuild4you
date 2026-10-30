'use client'

import { auth } from '@/lib/firebase/client'
import { signOut } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { User, LogOut, Shield, LayoutGrid, Info, Pencil, Check, X, KeyRound } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import { useQueryClient } from '@tanstack/react-query'
import { useApps, useCurrentUser, useUpdateCurrentUser } from '@/lib/query/hooks'
import { SetPasswordModal } from '@/components/SetPasswordModal'
import { useMakerCopy } from '@/components/locale-context'
import { copy } from '@/lib/copy'

export function UserMenu() {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [showSetPassword, setShowSetPassword] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()
  const updateUser = useUpdateCurrentUser()
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false
  const t = useMakerCopy().common
  // Non-admins who own or collaborate on a Loop app get a link to it.
  const { data: myApps } = useApps({ enabled: !!user && !isAdmin })
  const hasApps = !isAdmin && (myApps?.length ?? 0) > 0

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser)
    })
    return unsubscribe
  }, [])

  const handleSignOut = async () => {
    queryClient.clear()
    await signOut(auth)
    router.push(t.homeHref)
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
                    placeholder={t.labelPlaceholder}
                    maxLength={24}
                    className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-navy"
                  />
                  <button
                    onClick={saveLabel}
                    disabled={updateUser.isPending}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    aria-label={t.saveAccountName}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingLabel(false)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    aria-label={t.cancel}
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
                    {t.accountName}
                    {currentUser?.account_label ? (
                      <span className="block text-sm text-gray-800">
                        {currentUser.account_label}
                      </span>
                    ) : (
                      <span className="block text-sm text-gray-400 italic">{t.addLabel}</span>
                    )}
                  </span>
                  <Pencil className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 shrink-0" />
                </button>
              )}
            </div>

            <button
              onClick={() => {
                setShowDropdown(false)
                router.push(t.aboutHref)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <Info className="h-4 w-4" />
              {t.about}
            </button>
            <button
              onClick={() => {
                setShowDropdown(false)
                setShowSetPassword(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              {t.setPassword}
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
                {t.admin}
              </button>
            )}
            {hasApps && (
              <button
                onClick={() => {
                  setShowDropdown(false)
                  router.push('/admin/apps')
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
              >
                <LayoutGrid className="h-4 w-4" />
                {copy.adminApps.yourApps}
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              {t.signOut}
            </button>
          </div>
        </>
      )}

      <SetPasswordModal
        isOpen={showSetPassword}
        onClose={() => setShowSetPassword(false)}
        user={user}
      />
    </div>
  )
}
