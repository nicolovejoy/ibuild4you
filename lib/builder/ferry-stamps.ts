import { formatRelativeTime } from '@/lib/copy-maker'
import type { Project } from '@/lib/types'

// Stamp model for the Brief tab "ferry desk": when the prep prompt was copied,
// when a payload was pasted back, and the maker's last activity.

export type FerryStamp = { at: string | null; absolute: string; relative: string }
export type FerryStamps = {
  copied: FerryStamp
  pasted: FerryStamp & { version: number | null }
  maker: FerryStamp & { who: string | null; newerThanPaste: boolean }
}

// Stored timestamps are UTC; a human sees them in Pacific.
const pacific = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function isValid(iso: string | null | undefined): iso is string {
  return !!iso && !Number.isNaN(new Date(iso).getTime())
}

/** 'Oct 17, 9:14 AM' in Pacific; '' for missing or unparseable input. */
export function formatStampPacific(iso: string | null | undefined): string {
  return isValid(iso) ? pacific.format(new Date(iso)) : ''
}

/** True when the maker has been active since the last paste (or nothing was ever pasted). */
export function makerNewerThanPaste(p: {
  last_maker_message_at?: string | null
  payload_pasted_at?: string | null
}): boolean {
  if (!isValid(p.last_maker_message_at)) return false
  if (!isValid(p.payload_pasted_at)) return true
  return new Date(p.last_maker_message_at).getTime() > new Date(p.payload_pasted_at).getTime()
}

function stamp(iso: string | null | undefined, now: Date): FerryStamp {
  if (!isValid(iso)) return { at: null, absolute: '', relative: '' }
  return { at: iso, absolute: formatStampPacific(iso), relative: formatRelativeTime(iso, 'en', now) }
}

export function ferryStamps(
  project: Pick<
    Project,
    | 'prep_copied_at'
    | 'payload_pasted_at'
    | 'last_maker_message_at'
    | 'payload_pasted_version'
    | 'requester_first_name'
    | 'requester_email'
  >,
  now: Date = new Date()
): FerryStamps {
  const who = project.requester_first_name || project.requester_email?.split('@')[0] || null
  return {
    copied: stamp(project.prep_copied_at, now),
    pasted: { ...stamp(project.payload_pasted_at, now), version: project.payload_pasted_version ?? null },
    maker: {
      ...stamp(project.last_maker_message_at, now),
      who,
      newerThanPaste: makerNewerThanPaste(project),
    },
  }
}
