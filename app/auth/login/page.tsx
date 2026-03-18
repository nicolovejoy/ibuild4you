'use client'

import { useState } from 'react'
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { useEffect } from 'react'

const actionCodeSettings = {
  url: typeof window !== 'undefined' ? window.location.origin + '/auth/login' : '',
  handleCodeInApp: true,
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Handle magic link completion
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isSignInWithEmailLink(auth, window.location.href)) return

    let emailForSignIn = window.localStorage.getItem('emailForSignIn')
    if (!emailForSignIn) {
      emailForSignIn = window.prompt('Please provide your email for confirmation') || ''
    }

    signInWithEmailLink(auth, emailForSignIn, window.location.href)
      .then(() => {
        window.localStorage.removeItem('emailForSignIn')
        router.replace('/dashboard')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Sign-in failed')
      })
  }, [router])

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings)
      window.localStorage.setItem('emailForSignIn', email)
      setSuccess('Check your email for a sign-in link.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send sign-in link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-brand-charcoal">iBuild4you</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-gray-900">Welcome</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email and we&apos;ll send you a sign-in link
          </p>
        </div>

        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}

        <form onSubmit={handleSendLink} className="space-y-4">
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
          <LoadingButton
            type="submit"
            loading={loading}
            loadingText="Sending link..."
            fullWidth
            variant="primary"
          >
            Send sign-in link
          </LoadingButton>
        </form>
      </div>
    </div>
  )
}
