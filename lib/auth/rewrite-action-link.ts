// Point a Firebase-minted action link at our own handler.
//
// generatePasswordResetLink() returns a URL to Firebase's hosted page on
// <project>.firebaseapp.com. That page works, but a password manager keys the
// saved credential to the domain it was typed on — so a password set there is
// never offered back at ibuild4you.com. We host the same flow at /auth/action
// (see app/auth/action/page.tsx); this swaps the origin and path and keeps the
// query string intact.
//
// The console's "customize action URL" would do this globally, but it refuses
// to save for a project that isn't served by Firebase Hosting — we're on
// Vercel. Doing it in code is also better scoped: it only touches links in
// email WE send, which since PR #171 is all of them.
//
// Only `oobCode` carries state, and it's scoped to the Firebase project, not to
// the host that redeems it — which is why re-hosting the handler is safe.

export const ACTION_PATH = '/auth/action'

export function rewriteActionLink(link: string, appOrigin: string): string {
  let source: URL
  let target: URL
  try {
    source = new URL(link)
    target = new URL(appOrigin)
  } catch {
    // A link we can't parse is still a link the user can click — returning it
    // untouched costs them the password-manager benefit, not their reset.
    return link
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') return link

  const rewritten = new URL(ACTION_PATH, target.origin)
  rewritten.search = source.search
  return rewritten.toString()
}
