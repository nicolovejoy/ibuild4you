import { auth } from './client'

type FetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  await auth.authStateReady()
  const user = auth.currentUser
  const token = user ? await user.getIdToken() : null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, { ...options, headers })
}
