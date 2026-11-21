'use client'

import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Share2, Trash2 } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import {
  useArchiveProject,
  useCurrentUser,
  useProjectMembers,
  useUpdateProject,
} from '@/lib/query/hooks'
import { copy } from '@/lib/copy'
import { isBriefModel } from '@/lib/agent/model-choices'
import { LOCALES, LOCALE_NAMES, toLocale, type Locale } from '@/lib/locale'
import { connectionsSummary, reminderDetail, samSummary } from '@/lib/builder/settings-view'
import { AgentModelSelect } from './AgentModelSelect'
import { BuildStatusKeyPanel } from './BuildStatusKeyPanel'
import { ProjectEmailPanel, canSeeProjectEmail } from './ProjectEmailPanel'
import { CollapsibleSection } from './CollapsibleSection'
import { PeoplePanel } from './PeoplePanel'
import { DeleteBriefModal } from './DeleteBriefModal'
import type { Project } from '@/lib/types'

const t = copy.settings

// The builder Settings tab: who is on the brief, the standing settings, and
// archive and delete. Each control saves as it changes; there is no Save
// button. What Sam says in the next conversation (opening message, mode,
// questions, nudge) is not here: it arrives with each paste and is shown read
// only on the Conversations tab (NextRoundPanel).
export function SettingsTab({
  project,
  onShare,
  onGoToConversations,
}: {
  project: Project
  onShare: (mode?: 'maker' | 'add') => void
  onGoToConversations: () => void
}) {
  const updateProject = useUpdateProject()
  const archiveProject = useArchiveProject()
  const { data: currentUser } = useCurrentUser()
  // Delete is the owner's escape hatch. Same gate as before (system admin);
  // the route enforces owner too.
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false
  const [deleting, setDeleting] = useState(false)

  // Local mirrors, so a control shows its new value at once instead of waiting
  // for the refetch. They follow the project when it changes underneath.
  const [language, setLanguage] = useState<Locale>(toLocale(project.language))
  const [model, setModel] = useState(isBriefModel(project.model) ? project.model : '')
  const [autoReminders, setAutoReminders] = useState(project.auto_reminders_enabled === true)
  const [hideTitle, setHideTitle] = useState(project.hide_title_in_previews === true)
  const [githubRepo, setGithubRepo] = useState(project.github_repo || '')
  const [archived, setArchived] = useState(project.viewer_archived === true)

  useEffect(() => {
    setLanguage(toLocale(project.language))
    setModel(isBriefModel(project.model) ? project.model : '')
    setAutoReminders(project.auto_reminders_enabled === true)
    setHideTitle(project.hide_title_in_previews === true)
    setGithubRepo(project.github_repo || '')
    setArchived(project.viewer_archived === true)
  }, [
    project.language,
    project.model,
    project.auto_reminders_enabled,
    project.hide_title_in_previews,
    project.github_repo,
    project.viewer_archived,
  ])

  // One field at a time. The server leaves every field not named alone.
  const save = (fields: {
    language?: Locale
    model?: string | null
    auto_reminders_enabled?: boolean
    hide_title_in_previews?: boolean
    github_repo?: string
  }) => {
    updateProject.mutate({
      project_id: project.id,
      ...fields,
      last_builder_activity_at: new Date().toISOString(),
    })
  }

  // The repo saves when the field loses focus, and only when it changed.
  const saveRepo = () => {
    const next = githubRepo.trim()
    if (next === (project.github_repo || '').trim()) return
    save({ github_repo: next })
  }

  const toggleArchive = () => {
    const next = !archived
    setArchived(next)
    archiveProject.mutate(
      { project_id: project.id, archived: next },
      { onError: () => setArchived(!next) }
    )
  }

  // The header count reads the same cached list the panel shows.
  const { data: members } = useProjectMembers(project.id, !!project.requester_email, true)
  const peopleCount = members?.filter((m) => !m.removed_at).length ?? 0
  const peopleSummary = peopleCount > 0 ? t.people.summary(peopleCount) : t.people.summaryNone

  // The switches read the live values, so the summary and status follow a
  // change before the server answers.
  const live = {
    ...project,
    language,
    model: model || null,
    auto_reminders_enabled: autoReminders,
    github_repo: githubRepo,
  }
  const reminders = reminderDetail(live, Date.now())

  const checkbox = 'mt-0.5 h-4 w-4 rounded border-brand-line-strong text-brand-navy focus:ring-brand-navy'
  const field =
    'px-3 py-2 border border-brand-line-strong rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy'

  return (
    <div className="space-y-4">
      {/* One status line for every save on the page. */}
      <p role="status" className="h-4 text-xs text-brand-ink-soft text-right">
        {updateProject.isPending
          ? t.saving
          : updateProject.isError
            ? ''
            : updateProject.isSuccess
              ? t.saved
              : ''}
      </p>
      {updateProject.error && (
        <StatusMessage type="error" message={`${t.saveFailed} ${updateProject.error.message}`} />
      )}

      <CollapsibleSection title={t.people.heading} summary={peopleSummary}>
        {project.requester_email ? (
          <PeoplePanel project={project} onInvite={() => onShare('add')} />
        ) : (
          <div>
            <p className="text-sm text-brand-ink-soft mb-4">{t.people.empty}</p>
            <LoadingButton variant="primary" icon={Share2} onClick={() => onShare('maker')}>
              {t.people.invite}
            </LoadingButton>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={t.sam.heading} summary={samSummary(live)}>
        <div className="space-y-5">
          <div>
            <label
              htmlFor="maker-language"
              className="text-sm font-medium text-gray-700 block mb-1.5"
            >
              {t.sam.language}
            </label>
            <select
              id="maker-language"
              value={language}
              onChange={(e) => {
                const next = toLocale(e.target.value)
                setLanguage(next)
                save({ language: next })
              }}
              className={field}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{t.sam.languageHelp}</p>
          </div>

          <AgentModelSelect
            value={model}
            onChange={(next) => {
              setModel(isBriefModel(next) ? next : '')
              save({ model: next || null })
            }}
          />

          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoReminders}
                onChange={(e) => {
                  setAutoReminders(e.target.checked)
                  save({ auto_reminders_enabled: e.target.checked })
                }}
                className={checkbox}
              />
              <span>
                <span className="block text-sm font-medium text-gray-700">{t.sam.reminders}</span>
                <span className="block text-xs text-gray-400">{t.sam.remindersHelp}</span>
              </span>
            </label>
            {reminders && (
              <div className="ml-6 mt-2 rounded-md bg-brand-bubble border border-brand-line-soft px-3 py-2 text-xs text-brand-ink-soft space-y-0.5">
                <div>{reminders.sent}</div>
                <div className="text-brand-ink-soft">{reminders.next}</div>
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideTitle}
              onChange={(e) => {
                setHideTitle(e.target.checked)
                save({ hide_title_in_previews: e.target.checked })
              }}
              className={checkbox}
            />
            <span>
              <span className="block text-sm font-medium text-gray-700">{t.sam.hideTitle}</span>
              <span className="block text-xs text-gray-400">{t.sam.hideTitleHelp}</span>
            </span>
          </label>

          <p className="text-xs text-brand-ink-soft pt-3 border-t border-brand-line-soft">
            {t.sam.nextRound}{' '}
            <button
              type="button"
              onClick={onGoToConversations}
              className="font-medium text-brand-navy hover:underline"
            >
              {t.sam.nextRoundLink}
            </button>
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t.connections.heading}
        summary={connectionsSummary(live)}
        defaultOpen={false}
      >
        <div className="space-y-5">
          <div>
            <label htmlFor="github-repo" className="text-sm font-medium text-gray-700 block mb-1.5">
              {t.connections.repo}
            </label>
            <input
              id="github-repo"
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              onBlur={saveRepo}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder={t.connections.repoPlaceholder}
              className={`w-full ${field}`}
            />
            <p className="text-xs text-gray-400 mt-1">{t.connections.repoHelp}</p>
          </div>
          {/* The saved repo, not the unsaved input, so the panel names the repo the server uses. */}
          <BuildStatusKeyPanel
            projectId={project.id}
            githubRepo={project.github_repo}
            isSystemAdmin={isAdmin}
          />
          {canSeeProjectEmail(project.viewer_role, isAdmin) && (
            <ProjectEmailPanel projectId={project.id} />
          )}
        </div>
      </CollapsibleSection>

      {/* Archive is per viewer: it hides the brief from this person's dashboard only. */}
      <Card hover={false}>
        <CardBody className="px-5 sm:pl-12 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-[15px] font-semibold text-brand-charcoal">
              {t.archive.heading}
            </h2>
            <p className="text-xs text-brand-ink-soft mt-1">
              {archived ? t.archive.archivedHelp : t.archive.help}
            </p>
            {archiveProject.error && (
              <p className="text-xs text-red-600 mt-1">{archiveProject.error.message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={toggleArchive}
            disabled={archiveProject.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-brand-line-strong rounded-md hover:bg-brand-bubble disabled:opacity-50"
          >
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {archived ? t.archive.undo : t.archive.action}
          </button>
        </CardBody>
      </Card>

      {isAdmin && (
        <Card hover={false}>
          <CardBody className="px-5 sm:pl-12 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading text-[15px] font-semibold text-red-700">
                {t.delete.heading}
              </h2>
              <p className="text-xs text-brand-ink-soft mt-1">{copy.deleteProject.warning}</p>
            </div>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> {t.delete.action}
            </button>
          </CardBody>
        </Card>
      )}

      {deleting && <DeleteBriefModal project={project} onClose={() => setDeleting(false)} />}
    </div>
  )
}
