import { normalizeEmail } from '@/lib/email/normalize'

// One admin account since 2026-10-28; nicholas.lovejoy@gmail.com and
// mlovejoy@scu.edu are retired as admins.
export const ADMIN_EMAILS = ['nlovejoy@me.com']

// Who receives transactional/notification emails (interest form submissions,
// "your turn" alerts, etc.). Subset of ADMIN_EMAILS by design — being an admin
// grants access, not a subscription.
export const NOTIFICATION_EMAILS = ['nlovejoy@me.com']

// The app's only admin gate. Normalize the input — ADMIN_EMAILS entries are
// already lowercase by convention, but nothing previously enforced that a
// caller's token email arrived normalized too (#155).
export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(normalizeEmail(email))
}
