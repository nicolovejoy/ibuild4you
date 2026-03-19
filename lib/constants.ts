export const ADMIN_EMAILS = ['nlovejoy@me.com', 'nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu']

export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email)
}
