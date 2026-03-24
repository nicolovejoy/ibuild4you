import { auth } from './client'

type FetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  await auth.authStateReady()
  const user = auth.currentUser
  const token = user ? await user.getIdToken() : null

  const headers: Record<string, string> = {
    ...options.headers,
  }

  // Let browser set Content-Type for FormData (multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, { ...options, headers })
}
