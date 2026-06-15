import crypto from 'crypto'

// 6-char uppercase passcode for maker sign-in. Shared by the share route (mints
// it) and the maker-email route (resolves/mints it for the invite body).
export function generatePasscode(): string {
  return crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase()
}
