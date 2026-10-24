// Canned greeting for a maker who returns when the builder has queued nothing
// new (#214). Not model output: it is stored with kind 'unqueued_greeting'.
// Addressed to the maker by first name (projects.requester_first_name); it
// names nobody else, so there is no builder lookup here any more.

import { makerCopy } from '../copy-maker'
import type { Locale } from '../locale'

export function unqueuedGreeting(language: Locale, makerFirstName: string | null | undefined): string {
  return makerCopy[language].chat.nothingQueuedGreeting(makerFirstName?.trim() || null)
}
