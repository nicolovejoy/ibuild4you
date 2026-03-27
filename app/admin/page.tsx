'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Save } from 'lucide-react'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'

interface UserDoc {
  id: string
  email: string
  first_name?: string
  last_name?: string
  display_name?: string
  created_at?: string
  source?: string
  has_users_doc?: boolean
  role?: string
}

export default function AdminPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  useEscapeBack('/dashboard')

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) {
      router.push('/not-approved')
    }
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  const { data: currentUser, isLoading: roleLoading } = useCurrentUser()

  if (!user || !approved) return null

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false
  if (!isAdmin) {
    router.push('/dashboard')
    return null
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="p-1 hover:bg-gray-100 rounded">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h1 className="font-semibold text-brand-charcoal">Admin</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <UsersTable />
      </main>
    </div>
  )
}

function UsersTable() {
  const [users, setUsers] = useState<UserDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      const res = await apiFetch('/api/users')
      if (!res.ok) throw new Error('Failed to load users')
      setUsers(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">Loading users...</div>
  }

  if (error) {
    return <div className="text-center text-red-500 py-12">{error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide">
          Users ({users.length})
        </h2>
        <p className="text-xs text-gray-400">Edit names inline, then save</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {users.map((u) => (
          <UserRow key={u.id} user={u} onSaved={(updated) => {
            setUsers((prev) => prev.map((p) => p.id === updated.id ? updated : p))
          }} />
        ))}
      </div>
    </div>
  )
}

function UserRow({ user, onSaved }: { user: UserDoc; onSaved: (u: UserDoc) => void }) {
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isDirty = firstName !== (user.first_name || '') || lastName !== (user.last_name || '')
  const needsName = !user.first_name

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: user.id, email: user.email, first_name: firstName, last_name: lastName }),
      })
      if (!res.ok) throw new Error('Save failed')
      const updated = await res.json()
      onSaved(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${needsName ? 'bg-amber-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 truncate">{user.email}</p>
        {user.source && user.source !== 'users' && (
          <p className="text-[10px] text-gray-400">
            {user.source === 'project_member' ? `${user.role || 'member'} (no user doc)` : 'approved only'}
          </p>
        )}
      </div>
      <input
        type="text"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        placeholder="First"
        className="w-28 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
      />
      <input
        type="text"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        placeholder="Last"
        className="w-28 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
      />
      {saved ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="p-1.5 text-gray-400 hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Save"
        >
          <Save className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
