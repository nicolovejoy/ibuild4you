'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { authErrorMessage } from '@/lib/auth/password'
import { copy } from '@/lib/copy'
import { useRouter } from 'next/navigation'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'

function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // Common in-app browser signatures
  if (/FBAN|FBAV|Instagram|LinkedIn|Twitter|Line|WeChat|MicroMessenger/i.test(ua)) return true
  // iOS: has iPhone/iPad but no "Safari" token (in-app WebViews omit it)
  if (/(iPhone|iPad|iPod)/.test(ua) && !/Safari/.test(ua)) return true
  return false
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [redirectTo, setRedirectTo] = useState('/dashboard')
  const [linkCopied, setLinkCopied] = useState(false)
  const router = useRouter()

  const inAppBrowser = useMemo(() => isInAppBrowser(), [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirectTo')
    if (redirect) setRedirectTo(redirect)

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) router.push(redirect || '/dashboard')
    })
    return () => unsubscribe()
  }, [router])

  const handleGoogleSignIn = async () => {
    setError(null)
    setGoogleLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
      router.replace(redirectTo)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed'
      if (message.includes('sessionStorage') || message.includes('popup')) {
        setError('Google sign-in is not supported in this browser. Try opening the link in Safari or Chrome, or sign in with your password below.')
      } else if (message.includes('popup-blocked') || message.includes('cancelled-popup-request')) {
        setError('Pop-up was blocked. Try again, or sign in with your password below.')
      } else {
        setError(message)
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setPasswordLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      router.replace(redirectTo)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    setError(null)
    setInfo(null)
    if (!email.trim()) {
      setError('Enter your email above first, then tap “Forgot password?”')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (err) {
      // Don't leak whether the email exists — show the same confirmation on
      // user-not-found as on success. Only surface genuine errors (rate limit, network).
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code && code !== 'auth/user-not-found' && code !== 'auth/invalid-email') {
        setError(authErrorMessage(err))
        return
      }
    }
    setInfo(copy.auth.resetEmailSent(email.trim()))
  }

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const passwordForm = (
    <form onSubmit={handlePasswordSignIn} className="space-y-4">
      <div>
        <label htmlFor="pw-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="pw-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            {copy.auth.passwordLabel}
          </label>
          <button
            type="button"
            onClick={handleForgotPassword}
            className="text-sm text-brand-navy underline hover:text-brand-charcoal"
          >
            {copy.auth.forgotPassword}
          </button>
        </div>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          placeholder="Your password"
        />
      </div>
      <LoadingButton
        type="submit"
        loading={passwordLoading}
        loadingText="Signing in..."
        fullWidth
        variant="primary"
      >
        {copy.auth.signInPassword}
      </LoadingButton>
    </form>
  )

  const passwordDivider = (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-300" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-2 bg-brand-cream text-gray-500">{copy.auth.passwordDivider}</span>
      </div>
    </div>
  )

  const googleButton = (
    <LoadingButton
      type="button"
      loading={googleLoading}
      loadingText="Signing in..."
      fullWidth
      variant="primary"
      onClick={handleGoogleSignIn}
    >
      Sign in with Google
    </LoadingButton>
  )

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-brand-charcoal">iBuild4you</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-gray-900">Welcome</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to continue
          </p>
        </div>

        {inAppBrowser && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">Looks like you&apos;re in an in-app browser</p>
            <p className="mb-2">Google sign-in may not work here. Sign in with your email and password, or open this page in Safari or Chrome.</p>
            <button
              onClick={handleCopyLink}
              className="text-amber-900 underline font-medium"
            >
              {linkCopied ? 'Copied!' : 'Copy link to clipboard'}
            </button>
          </div>
        )}

        {error && <StatusMessage type="error" message={error} />}
        {info && <StatusMessage type="success" message={info} />}

        {/* Google first, password second. Passcode sign-in retired (Garm PR D);
            the #pw-email / #password ids are load-bearing for the e2e harness. */}
        {googleButton}
        {passwordDivider}
        {passwordForm}

        <p className="text-center text-sm text-gray-500">
          Not sure what this is?{' '}
          <Link href="/about" className="underline hover:text-gray-700">
            Learn more
          </Link>
        </p>
      </div>
    </div>
  )
}
