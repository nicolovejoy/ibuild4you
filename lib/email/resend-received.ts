// Fetch one received (inbound) email from Resend by id. Resend's
// `email.received` webhook carries metadata only; the body, the headers and
// the authentication results (SPF, DKIM, DMARC) come from this second call.
//
// Every field of the response is treated as untrusted and possibly of the
// wrong type: each one is checked and given a safe default. Nothing here logs
// an address, a subject or a body: ids and status codes only.

export interface ReceivedEmail {
  from: string // the top-level bare address Resend parsed, '' when absent
  header_from: string | null // the raw From header (`"Name" <addr>`), when a string
  subject: string
  message_id: string
  text: string // plain text, else the html stripped, else ''
  sent_at: string | null // the Date header as UTC ISO, when it parses
  received_at: string | null // Resend's created_at as UTC ISO, when it parses
  dmarc: string | null // authentication.dmarc as Resend gave it
  attachments: { filename: string; content_type: string }[] // names only
}

// Default URL template for fetching a received email by id. This is Resend's
// receiving endpoint, checked against a real email on 2026-11-20 (it needs a
// key that can read received mail). RESEND_INBOUND_FETCH_URL, a template
// containing `{id}`, overrides it if Resend moves it again.
const DEFAULT_FETCH_URL_TEMPLATE = 'https://api.resend.com/emails/receiving/{id}'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

// A time string as UTC ISO, or null when it is not a string or does not parse.
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

// Resend gives the Date header as a time wrapped in literal double quotes
// ("\"2026-11-20T17:44:55.000Z\""). Strip one wrapping pair, then parse.
function parseDateHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const unquoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  return isoOrNull(unquoted)
}

function parseAttachments(value: unknown): ReceivedEmail['attachments'] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((item) => ({
    filename: stringOr(item.filename, ''),
    content_type: stringOr(item.content_type, ''),
  }))
}

// Shape the fetched JSON. Returns null only when it is not an object.
function toReceivedEmail(json: unknown): ReceivedEmail | null {
  if (!isObject(json)) return null
  const headers = isObject(json.headers) ? json.headers : {}
  const authentication = isObject(json.authentication) ? json.authentication : {}

  let text = ''
  if (isNonBlank(json.text)) text = json.text
  else if (isNonBlank(json.html)) text = stripHtml(json.html)

  return {
    from: stringOr(json.from, ''),
    header_from: typeof headers.from === 'string' ? headers.from : null,
    subject: stringOr(json.subject, ''),
    message_id: stringOr(json.message_id, ''),
    text,
    sent_at: parseDateHeader(headers.date),
    received_at: isoOrNull(json.created_at),
    dmarc: typeof authentication.dmarc === 'string' ? authentication.dmarc : null,
    attachments: parseAttachments(json.attachments),
  }
}

// The received email, or null on any failure: no id, no API key, a non-200
// answer, a thrown error, or a body that is not a JSON object. An email with
// no body is not a failure: its text is ''.
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  if (typeof emailId !== 'string' || !emailId) return null
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[resend-received] RESEND_API_KEY not set; cannot fetch', emailId)
    return null
  }
  const template = process.env.RESEND_INBOUND_FETCH_URL?.trim() || DEFAULT_FETCH_URL_TEMPLATE
  const url = template.replace('{id}', encodeURIComponent(emailId))

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.warn(`[resend-received] fetch ${res.status} for ${emailId}`)
      return null
    }
    const email = toReceivedEmail(await res.json())
    if (!email) console.warn(`[resend-received] response for ${emailId} is not an object`)
    return email
  } catch (err) {
    // The error's name only: a parse error's message can quote the response.
    console.warn(
      `[resend-received] fetch for ${emailId} threw:`,
      err instanceof Error ? err.name : 'unknown'
    )
    return null
  }
}

// Crude HTML → text. Inbound replies arrive with quoted history regardless;
// we're not trying to produce a clean digest, just something readable.
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
