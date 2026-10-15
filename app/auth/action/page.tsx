'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { authErrorMessage, validatePassword } from '@/lib/auth/password'
import { parseActionMode, safeContinueUrl } from '@/lib/auth/action-params'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { useLocale, useMakerCopy } from '@/components/locale-context'

// Custom Firebase email-action handler.
//
// Firebase's hosted page lives on <project>.firebaseapp.com, which breaks two
// things: password managers save the new credential against THAT domain and
// never offer it back at ibuild4you.com, and the post-reset page dead-ends on
// a bare Continue button. Hosting the handler ourselves fixes both — the whole
// flow stays on our origin.
//
// Wired up by setting the action URL to https://ibuild4you.com/auth/action in
// Firebase console → Authentication → Templates → (pencil) → customize action
// URL. That setting is per Firebase project, so prod and preview each need it.
//
// Only resetPassword is implemented, because it's the only action email we
// send. verifyEmail/recoverEmail are recognized so they render an honest
// message instead of a blank screen if one is ever triggered.

const REDIRECT_SECONDS = 5

function ActionHandler() {
  const { locale } = useLocale()
  const t = useMakerCopy().action
  const params = useSearchParams()
  const mode = parseActionMode(params.get('mode'))
  const oobCode = params.get('oobCode') || ''

  // Resolved against our own origin; a continueUrl pointing anywhere else is
  // discarded (see safeContinueUrl — this param comes from the email link).
  const [continueUrl, setContinueUrl] = useState('/auth/login')
  useEffect(() => {
    setContinueUrl(safeContinueUrl(params.get('continueUrl'), window.location.origin))
  }, [params])

  // null = still verifying the code, '' = code was rejected.
  const [email, setEmail] = useState<string | null>(null)
  // The raw error, rendered via authErrorMessage at display time so it follows
  // the viewer's language even if that resolves after verification.
  const [verifyError, setVerifyError] = useState<unknown>(null)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS)

  // Exchange the one-time code for the account's email. Doing this up front
  // means an expired link says so immediately, instead of after the user has
  // picked and typed a password twice.
  useEffect(() => {
    if (mode !== 'resetPassword' || !oobCode) return
    let cancelled = false
    verifyPasswordResetCode(auth, oobCode)
      .then((addr) => {
        if (!cancelled) setEmail(addr)
      })
      .catch((err) => {
        if (!cancelled) {
          setEmail('')
          setVerifyError(err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mode, oobCode])

  // Auto-redirect after success — the thing Firebase's hosted page wouldn't do.
  useEffect(() => {
    if (!done) return
    if (countdown <= 0) {
      window.location.href = continueUrl
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [done, countdown, continueUrl])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const invalid = validatePassword(password, locale)
    if (invalid) {
      setError(invalid)
      return
    }
    if (password !== confirm) {
      setError(t.mismatch)
      return
    }

    setLoading(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      setDone(true)
    } catch (err) {
      setError(authErrorMessage(err, locale))
    } finally {
      setLoading(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        {children}
      </div>
    </div>
  )

  if (!mode || !oobCode) {
    return shell(
      <>
        <h1 className="text-lg font-semibold text-gray-900">{t.invalidTitle}</h1>
        <p className="text-sm text-gray-600">{t.invalidBody}</p>
        <Link href="/auth/login" className="text-sm text-blue-600 hover:underline">
          {t.goToSignIn}
        </Link>
      </>
    )
  }

  if (mode !== 'resetPassword') {
    return shell(
      <>
        <h1 className="text-lg font-semibold text-gray-900">{t.unsupportedTitle}</h1>
        <p className="text-sm text-gray-600">{t.unsupportedBody}</p>
        <Link href="/auth/login" className="text-sm text-blue-600 hover:underline">
          {t.goToSignIn}
        </Link>
      </>
    )
  }

  if (done) {
    return shell(
      <>
        <StatusMessage type="success" message={t.resetSuccess} />
        <p className="text-sm text-gray-600">
          {t.redirecting(countdown)}
        </p>
        <a href={continueUrl} className="text-sm text-blue-600 hover:underline">
          {t.continueNow}
        </a>
      </>
    )
  }

  if (email === null) {
    return shell(<p className="text-sm text-gray-500">{t.checking}</p>)
  }

  if (email === '') {
    return shell(
      <>
        <h1 className="text-lg font-semibold text-gray-900">{t.expiredTitle}</h1>
        {verifyError != null && <StatusMessage type="error" message={authErrorMessage(verifyError, locale)} />}
        <p className="text-sm text-gray-600">{t.expiredBody}</p>
        <Link href="/auth/login" className="text-sm text-blue-600 hover:underline">
          {t.goToSignIn}
        </Link>
      </>
    )
  }

  return shell(
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">{t.resetTitle}</h1>
      {error && <StatusMessage type="error" message={error} />}

      {/*
        Visible and readonly rather than hidden: password managers pair the new
        password with the username field on the same form, and many ignore a
        display:none input. This is what makes 1Password save the credential
        against ibuild4you.com correctly.
      */}
      <div>
        <label htmlFor="action-email" className="block text-sm font-medium text-gray-700 mb-1">
          {t.emailLabel}
        </label>
        <input
          id="action-email"
          name="username"
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
        />
      </div>

      <div>
        <label htmlFor="action-password" className="block text-sm font-medium text-gray-700 mb-1">
          {t.newPassword}
        </label>
        <input
          id="action-password"
          name="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>

      <div>
        <label htmlFor="action-confirm" className="block text-sm font-medium text-gray-700 mb-1">
          {t.confirmPassword}
        </label>
        <input
          id="action-confirm"
          name="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>

      <p className="text-sm text-gray-500">{t.setPasswordHelp}</p>

      <LoadingButton type="submit" loading={loading} fullWidth variant="primary">
        {t.submit}
      </LoadingButton>
    </form>
  )
}

export default function AuthActionPage() {
  const { common } = useMakerCopy()
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-400">{common.loading}</div>
      }
    >
      <ActionHandler />
    </Suspense>
  )
}
