'use client'

import { useState } from 'react'
import { HttpError, useAppAdmins, useGrantAppAdmin, useRevokeAppAdmin } from '@/lib/query/hooks'
import { copy } from '@/lib/copy'

const t = copy.adminApps

const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })

function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.message === 'last_owner') return t.errorLastOwner
    if (err.status === 403) return t.errorNotOwner
    if (err.status === 502 || err.status === 503) return t.errorGarmDown
  }
  return t.errorGeneric
}

// An app's admin list. Read live from Garm on every load; nothing is kept here.
export function ManageAdmins({ slug }: { slug: string }) {
  const { data: admins, isLoading, error } = useAppAdmins(slug)
  const grant = useGrantAppAdmin(slug)
  const revoke = useRevokeAppAdmin(slug)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'owner' | 'collaborator'>('collaborator')
  const [actionError, setActionError] = useState<string | null>(null)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError(null)
    try {
      await grant.mutateAsync({ email: email.trim(), role })
      setEmail('')
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const remove = async (target: string) => {
    setActionError(null)
    try {
      await revoke.mutateAsync({ email: target })
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const input =
    'px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy'

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-brand-charcoal">{t.adminsHeading}</h2>
        <p className="text-xs text-gray-500">{t.adminsNote}</p>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">{copy.loading}</div>}
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {errorText(error)}
        </p>
      )}

      {admins && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-brand-slate border-b border-gray-100">
              <th className="px-3 py-2">{t.emailLabel}</th>
              <th className="px-3 py-2">{t.accessLabel}</th>
              <th className="px-3 py-2">{t.addedLabel}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.email} className="border-b border-gray-50 last:border-0">
                <td className="px-3 py-2 text-brand-charcoal">{a.email}</td>
                <td className="px-3 py-2 text-xs">
                  {a.role === 'owner' ? t.roleOwner : t.roleCollaborator}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {a.created_at ? dateFmt.format(new Date(a.created_at)) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => remove(a.email)}
                    disabled={revoke.isPending}
                    className="text-xs text-red-500 hover:underline disabled:opacity-30"
                  >
                    {t.removeAdmin}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.emailLabel}</span>
          <input
            type="email"
            aria-label={t.emailLabel}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
        </label>
        <select
          aria-label={t.accessLabel}
          value={role}
          onChange={(e) => setRole(e.target.value as 'owner' | 'collaborator')}
          className={input}
        >
          <option value="owner">{t.roleOwner}</option>
          <option value="collaborator">{t.roleCollaborator}</option>
        </select>
        <button
          type="submit"
          disabled={grant.isPending || !email.trim()}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {t.addAdmin}
        </button>
      </form>
      {actionError && (
        <p role="alert" className="text-xs text-red-500">
          {actionError}
        </p>
      )}
    </section>
  )
}
