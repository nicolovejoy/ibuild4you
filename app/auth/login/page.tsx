'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
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
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [redirectTo, setRedirectTo] = useState('/dashboard')
  const [linkCopied, setLinkCopied] = useState(false)
  const router = useRouter()

  // If redirecting to a project, the user is likely a maker with a passcode
  const isMakerFlow = useMemo(() => redirectTo.startsWith('/projects/'), [redirectTo])
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
        setError('Google sign-in is not supported in this browser. Try opening the link in Safari or Chrome, or use the passcode below.')
      } else if (message.includes('popup-blocked') || message.includes('cancelled-popup-request')) {
        setError('Pop-up was blocked. Try again, or use the passcode to sign in.')
      } else {
        setError(message)
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  const handlePasscodeSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), passcode: passcode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Invalid email or passcode')
      }
      await signInWithCustomToken(auth, data.token)
      router.replace(redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const passcodeForm = (
    <form onSubmit={handlePasscodeSignIn} className="space-y-4">
      {isMakerFlow && (
        <p className="text-sm text-gray-600">
          Enter the email and passcode from your invite.
        </p>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="passcode" className="block text-sm font-medium text-gray-700 mb-1">
          Passcode
        </label>
        <input
          id="passcode"
          type="text"
          required
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-lg tracking-widest shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
          placeholder="ABC123"
        />
      </div>
      <LoadingButton
        type="submit"
        loading={loading}
        loadingText="Signing in..."
        fullWidth
        variant={isMakerFlow ? 'primary' : 'secondary'}
      >
        Sign in with passcode
      </LoadingButton>
    </form>
  )

  const divider = (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-300" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-2 bg-brand-cream text-gray-500">
          {isMakerFlow ? 'or' : 'or sign in with a passcode'}
        </span>
      </div>
    </div>
  )

  const googleButton = (
    <LoadingButton
      type="button"
      loading={googleLoading}
      loadingText="Signing in..."
      fullWidth
      variant={isMakerFlow ? 'secondary' : 'primary'}
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
            <p className="mb-2">Google sign-in may not work here. Use the passcode from your invite, or open this page in Safari or Chrome.</p>
            <button
              onClick={handleCopyLink}
              className="text-amber-900 underline font-medium"
            >
              {linkCopied ? 'Copied!' : 'Copy link to clipboard'}
            </button>
          </div>
        )}

        {error && <StatusMessage type="error" message={error} />}

        {isMakerFlow ? (
          <>
            {passcodeForm}
            {divider}
            {googleButton}
          </>
        ) : (
          <>
            {googleButton}
            {divider}
            {passcodeForm}
          </>
        )}
      </div>
    </div>
  )
}
