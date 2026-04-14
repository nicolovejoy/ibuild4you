export const ADMIN_EMAILS = ['nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu']

// Who receives transactional/notification emails (interest form submissions,
// "your turn" alerts, etc.). Subset of ADMIN_EMAILS by design — being an admin
// grants access, not a subscription.
export const NOTIFICATION_EMAILS = ['nicholas.lovejoy@gmail.com']

export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email)
}
