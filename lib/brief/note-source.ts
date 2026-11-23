import type { BriefNote, BriefNoteSource } from '@/lib/types'

// What a note was made from: the conversation, an email, or both. Headings on
// the Brief tab and in Sam's prompt use it (#276).
//
// A note carries `made_from` from #276 on. The fallback is for notes written
// before the field existed: email_sources says emails were involved, and
// session_id says whether a chat session was too. It can misread "both" as
// "email" when the chat sat in an archived session (session_id is null then).
export function noteSource(
  n: Pick<BriefNote, 'made_from' | 'email_sources' | 'session_id'>,
): BriefNoteSource {
  if (n.made_from) return n.made_from
  if (n.email_sources && n.email_sources.length > 0) {
    return n.session_id ? 'both' : 'email'
  }
  return 'chat'
}
