'use client'

import { useState } from 'react'
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { Modal } from '@/components/ui/Modal'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { authErrorMessage, validatePassword } from '@/lib/auth/password'
import { copy } from '@/lib/copy'

interface SetPasswordModalProps {
  isOpen: boolean
  onClose: () => void
  user: User
}

/**
 * Links an email/password credential to the already-signed-in account (#104).
 * Closed signup: we never create a new account here — we attach a password to
 * the existing Google UID so roles + memberships are preserved.
 */
export function SetPasswordModal({ isOpen, onClose, user }: SetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const close = () => {
    setPassword('')
    setConfirm('')
    setError(null)
    setSuccess(false)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const invalid = validatePassword(password)
    if (invalid) {
      setError(invalid)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!user.email) {
      setError('Your account has no email address to attach a password to.')
      return
    }

    setLoading(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, password)
      try {
        await linkWithCredential(user, credential)
      } catch (err) {
        // Linking may need a fresh login. Re-auth with Google, then retry once.
        const code =
          err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
        if (code === 'auth/requires-recent-login') {
          await reauthenticateWithPopup(user, new GoogleAuthProvider())
          await linkWithCredential(user, credential)
        } else {
          throw err
        }
      }
      setSuccess(true)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title={copy.auth.setPassword} size="sm">
      {success ? (
        <div className="space-y-4">
          <StatusMessage type="success" message={copy.auth.setPasswordSuccess} />
          <LoadingButton type="button" loading={false} fullWidth variant="primary" onClick={close}>
            Done
          </LoadingButton>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">{copy.auth.setPasswordHelp}</p>
          {error && <StatusMessage type="error" message={error} />}
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <LoadingButton
            type="submit"
            loading={loading}
            loadingText="Saving..."
            fullWidth
            variant="primary"
          >
            {copy.auth.setPassword}
          </LoadingButton>
        </form>
      )}
    </Modal>
  )
}
