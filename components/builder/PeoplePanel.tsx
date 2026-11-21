'use client'

import { useState } from 'react'
import { Check, Copy, Plus, RotateCw, Trash2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import {
  useProjectMembers,
  useSetBriefRole,
  useSetMemberRole,
  useRemoveMember,
  useRestoreMember,
} from '@/lib/query/hooks'
import { copy } from '@/lib/copy'
import { briefRoleLabel, briefRoleShort } from '@/lib/roles/display'
import { MEMBER_ROLES, memberRoleLabel } from '@/lib/roles/member-role'
import { useAuth } from '@/lib/hooks/useAuth'
import { isSelfRow } from '@/lib/members/self'
import { getProjectShareLink } from '@/lib/url'
import type { Project } from '@/lib/types'

// People on this brief: lists members with their access tier + an editable
// brief_role for chat participants (Originator/Contributor/Reviewer). Console
// operators (owner/builder) operate in a reviewing capacity — shown read-only.
// Rendered inside the Settings tab's People section, which supplies the
// heading and the frame.
export function PeoplePanel({ project, onInvite }: { project: Project; onInvite: () => void }) {
  // include_removed so moved-out members show with a Restore action (#106 P2).
  const { data: members, isLoading, error } = useProjectMembers(project.id, true, true)
  const setBriefRole = useSetBriefRole(project.id)
  const setMemberRole = useSetMemberRole(project.id)
  const removeMember = useRemoveMember(project.id)
  const restoreMember = useRestoreMember(project.id)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [pendingTierId, setPendingTierId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const { user } = useAuth()

  const active = members?.filter((m) => !m.removed_at) ?? []
  const removed = members?.filter((m) => m.removed_at) ?? []

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={onInvite}
          className="text-xs text-brand-navy hover:underline flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Invite
        </button>
      </div>

      {/* One sign-in link for the whole brief (#81, reshaped by Garm PR D):
            everyone signs in with Google or their own password, so there is
            nothing per-person to reveal — this is the link the operator re-sends. */}
      <ProjectLinkCopy project={project} />

      {isLoading && <Skeleton className="h-12 w-full" />}
      {error && <StatusMessage type="error" message={(error as Error).message} />}
      {members && members.length === 0 && (
        <p className="text-sm text-gray-500">No one yet. Invite someone to start the brief.</p>
      )}

      <ul className="divide-y divide-gray-100">
        {active.map((m) => {
          const isConsole = m.role === 'owner' || m.role === 'builder'
          const confirming = confirmRemoveId === m.id
          // #245: your own row is read-only; the server refuses self-edits too.
          const isSelf = isSelfRow(m.email, user?.email)
          return (
            <li key={m.id} className="py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-charcoal truncate">
                    {m.display_name}
                    {isSelf && (
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        {copy.builderChat.you}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Access tier (permission level) — editable for every member but you. */}
                  {isSelf ? (
                    <span className="text-xs text-gray-600 px-1">
                      {memberRoleLabel(m.role ?? 'maker')}
                    </span>
                  ) : (
                    <select
                      aria-label="Access tier"
                      value={m.role ?? 'maker'}
                      disabled={setMemberRole.isPending && pendingTierId === m.id}
                      onChange={async (e) => {
                        const value = e.target.value
                        setPendingTierId(m.id)
                        try {
                          await setMemberRole.mutateAsync({ memberId: m.id, role: value })
                        } finally {
                          setPendingTierId(null)
                        }
                      }}
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy"
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {memberRoleLabel(r)}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Brief role (what they do) — console operators review by default. */}
                  {isConsole ? (
                    <span className="text-xs text-gray-400 px-1" title={briefRoleShort('reviewer')}>
                      {briefRoleLabel('reviewer')}
                    </span>
                  ) : isSelf ? (
                    <span className="text-xs text-gray-600 px-1">
                      {briefRoleLabel(m.brief_role ?? 'originator')}
                    </span>
                  ) : (
                    <select
                      aria-label="Brief role"
                      value={m.brief_role ?? 'originator'}
                      disabled={setBriefRole.isPending && pendingEmail === m.email}
                      onChange={async (e) => {
                        const value = e.target.value
                        setPendingEmail(m.email)
                        try {
                          await setBriefRole.mutateAsync({ email: m.email, brief_role: value })
                        } finally {
                          setPendingEmail(null)
                        }
                      }}
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy"
                    >
                      <option value="originator">{briefRoleLabel('originator')}</option>
                      <option value="contributor">{briefRoleLabel('contributor')}</option>
                      <option value="reviewer">{briefRoleLabel('reviewer')}</option>
                    </select>
                  )}
                  {/* Move out (#106) — non-destructive, two-step inline confirm. */}
                  {!isSelf && (
                    <button
                      onClick={() => setConfirmRemoveId(m.id)}
                      title="Remove from brief"
                      aria-label="Remove from brief"
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {confirming && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-red-50 border border-red-200 p-2">
                  <span className="text-xs text-red-800">
                    Remove {m.display_name} from this brief? Their access is revoked; you can
                    restore them later.
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setConfirmRemoveId(null)}
                      className="text-xs text-gray-600 hover:underline px-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await removeMember.mutateAsync(m.id)
                        } finally {
                          setConfirmRemoveId(null)
                        }
                      }}
                      disabled={removeMember.isPending}
                      className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded px-2 py-1 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {removed.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Removed
          </p>
          <ul className="divide-y divide-gray-100">
            {removed.map((m) => (
              <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-500 truncate line-through">{m.display_name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {m.email}
                    {m.removed_at && ` · removed ${new Date(m.removed_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => restoreMember.mutate(m.id)}
                  disabled={restoreMember.isPending}
                  className="text-xs text-brand-navy hover:underline flex items-center gap-1 shrink-0 disabled:opacity-50"
                >
                  <RotateCw className="h-3.5 w-3.5" /> Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {setBriefRole.error && (
        <StatusMessage type="error" message={(setBriefRole.error as Error).message} />
      )}
      {setMemberRole.error && (
        <StatusMessage type="error" message={(setMemberRole.error as Error).message} />
      )}
      {removeMember.error && (
        <StatusMessage type="error" message={(removeMember.error as Error).message} />
      )}
      {restoreMember.error && (
        <StatusMessage type="error" message={(restoreMember.error as Error).message} />
      )}
    </div>
  )
}

// The brief's sign-in link, copyable once for the whole roster. Passcodes are
// retired (Garm PR D): everyone signs in with Google or their own password
// ("Forgot password?" sets one), so the share link is all there is to re-send.
function ProjectLinkCopy({ project }: { project: Project }) {
  const [copied, setCopied] = useState(false)
  const link = getProjectShareLink(project.slug, project.id)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mb-3 rounded-md bg-gray-50 border border-gray-200 p-2.5">
      <p className="text-[11px] text-gray-500 mb-0.5">Sign-in link</p>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate px-2 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700">
          {link}
        </code>
        <button
          onClick={handleCopy}
          className="p-1 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded shrink-0"
          title="Copy link"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        They sign in with Google or their email + password &mdash; &ldquo;Forgot password?&rdquo; on
        the sign-in page sets one.
      </p>
    </div>
  )
}
