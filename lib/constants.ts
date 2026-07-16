import { normalizeEmail } from '@/lib/email/normalize'

export const ADMIN_EMAILS = ['nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu', 'nlovejoy@me.com']

// Who receives transactional/notification emails (interest form submissions,
// "your turn" alerts, etc.). Subset of ADMIN_EMAILS by design — being an admin
// grants access, not a subscription.
export const NOTIFICATION_EMAILS = ['nicholas.lovejoy@gmail.com']

// The app's only admin gate. Normalize the input — ADMIN_EMAILS entries are
// already lowercase by convention, but nothing previously enforced that a
// caller's token email arrived normalized too (#155).
export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(normalizeEmail(email))
}
