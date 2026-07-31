// Client-side caller for POST /api/auth/reset-password.
//
// Replaces Firebase's sendPasswordResetEmail() at both call sites (the login
// page's "Forgot password?" and SetPasswordModal's provider-less fallback), so
// reset mail goes out through our own Resend sender instead of Firebase's
// <project>.firebaseapp.com one. See the route for the full rationale.
//
// Unauthenticated on purpose — no apiFetch, no Bearer token; the caller is by
// definition someone who can't sign in.

export type RequestResetResult =
  | { ok: true }
  | { ok: false; rateLimited: true; message: string }

export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  let res: Response
  try {
    res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
  } catch {
    // Network failure. Report success anyway: the confirmation copy is
    // deliberately non-committal ("if an account exists..."), and surfacing a
    // hard error here would be a worse experience than a retry. The user can
    // simply tap again.
    return { ok: true }
  }

  if (res.status === 429) {
    const body = await res.json().catch(() => null)
    return {
      ok: false,
      rateLimited: true,
      message:
        (body && typeof body.error === 'string' && body.error) ||
        'Too many reset requests. Try again later.',
    }
  }

  // Every other status — including a 500 — reports success. The endpoint
  // answers 200 for both "sent" and "no such account", and anything that leaks
  // a difference here would undo that.
  return { ok: true }
}
