// Key handling for the brief reader launcher (scripts/brief-reader.mjs).
// Pure: no I/O, no child_process, no process.env (the caller passes env and a
// fetch function), so it is tested without 1Password.
//
// The key is a service-account credential that can read all of production.
// Nothing here may put any of it, or any of 1Password's output, into an error
// message. Messages are one plain line, safe to print.

export class ReaderKeyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReaderKeyError'
  }
}

// Returns the trimmed text when it is a JSON object with a non-empty string
// client_email and private_key. Otherwise throws without echoing the input.
export function parseServiceAccountKey(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) throw new ReaderKeyError('the read-only key is empty.')

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Not the parse error itself: V8's message can quote part of the input.
    throw new ReaderKeyError('the read-only key is not valid JSON.')
  }

  const ok =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof parsed.client_email === 'string' &&
    parsed.client_email !== '' &&
    typeof parsed.private_key === 'string' &&
    parsed.private_key !== ''
  if (!ok) {
    throw new ReaderKeyError('the read-only key is not a service-account key (needs client_email and private_key).')
  }
  return trimmed
}

// Only a short token-like value is allowed into a message, so even an odd
// `code` cannot smuggle in output or a newline.
const safeToken = (v) => (['string', 'number'].includes(typeof v) && /^[A-Za-z0-9_-]{1,40}$/.test(String(v)) ? String(v) : null)

// env.FIREBASE_SERVICE_ACCOUNT_RO wins when set (a person or test supplying the
// key directly); otherwise fetchFromOnePassword() supplies it.
export function resolveReaderKey({ env, fetchFromOnePassword }) {
  const fromEnv = env?.FIREBASE_SERVICE_ACCOUNT_RO
  if (typeof fromEnv === 'string' && fromEnv !== '') {
    return { key: parseServiceAccountKey(fromEnv), source: 'env' }
  }

  let text
  try {
    text = fetchFromOnePassword()
  } catch (err) {
    // Report only the error's code or exit status, never message/stdout/stderr.
    const code = safeToken(err?.code)
    const status = safeToken(err?.status)
    const detail = code ? ` (${code})` : status ? ` (exit status ${status})` : ''
    throw new ReaderKeyError(`could not get the read-only key from 1Password${detail}.`)
  }
  return { key: parseServiceAccountKey(text), source: '1password' }
}
