import { formatRelativeTime } from '@/lib/copy-maker'
import type { Project } from '@/lib/types'

// Stamp model for the Brief tab "ferry desk": when the prep prompt was copied,
// when a payload was pasted back, and the maker's last activity.

// Where a stamp sits in time among the three, so the desk can colour the
// order at a glance (newest green → oldest red). null when the stamp is missing.
export type StampRecency = 'newest' | 'middle' | 'oldest'

export type FerryStamp = {
  at: string | null
  absolute: string
  relative: string
  recency: StampRecency | null
}
// Whether the last paste is still the one the maker has to answer.
//   none             nothing was ever pasted
//   current          pasted, and the maker has not written since
//   used             the maker has written since: the round is the builder's
//   used_prep_copied the same, and the prep was copied after the maker's last
//                    message: the next paste is what is missing
export type PasteStatus = 'none' | 'current' | 'used' | 'used_prep_copied'

export type FerryStamps = {
  pasteStatus: PasteStatus
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

/** Where the round stands, read from the same three stamps as the cards. */
export function pasteStatus(p: {
  payload_pasted_at?: string | null
  last_maker_message_at?: string | null
  prep_copied_at?: string | null
}): PasteStatus {
  if (!isValid(p.payload_pasted_at)) return 'none'
  if (!makerNewerThanPaste(p)) return 'current'
  const prepAfterMaker =
    isValid(p.prep_copied_at) &&
    new Date(p.prep_copied_at).getTime() > new Date(p.last_maker_message_at!).getTime()
  return prepAfterMaker ? 'used_prep_copied' : 'used'
}

function stamp(iso: string | null | undefined, now: Date): FerryStamp {
  if (!isValid(iso)) return { at: null, absolute: '', relative: '', recency: null }
  return {
    at: iso,
    absolute: formatStampPacific(iso),
    relative: formatRelativeTime(iso, 'en', now),
    recency: null, // filled in by rankRecency once all three exist
  }
}

// Rank the present stamps by time: the latest is 'newest', the earliest
// 'oldest', anything between 'middle'. A lone stamp is 'newest'.
function rankRecency(stamps: FerryStamp[]): void {
  const present = stamps
    .filter((s) => s.at !== null)
    .sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime())
  present.forEach((s, i) => {
    if (i === 0) s.recency = 'newest'
    else if (i === present.length - 1) s.recency = 'oldest'
    else s.recency = 'middle'
  })
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
  const stamps: FerryStamps = {
    pasteStatus: pasteStatus(project),
    copied: stamp(project.prep_copied_at, now),
    pasted: { ...stamp(project.payload_pasted_at, now), version: project.payload_pasted_version ?? null },
    maker: {
      ...stamp(project.last_maker_message_at, now),
      who,
      newerThanPaste: makerNewerThanPaste(project),
    },
  }
  rankRecency([stamps.copied, stamps.pasted, stamps.maker])
  return stamps
}
