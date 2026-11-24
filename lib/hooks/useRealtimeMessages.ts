'use client'

import { useEffect } from 'react'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/firebase/client'
import type { Message } from '@/lib/types'

/**
 * Subscribes to Firestore messages for a session via onSnapshot.
 * Updates the React Query cache directly so components using useMessages
 * get real-time updates without polling.
 *
 * A snapshot answered from the SDK's local cache (metadata.fromCache) is
 * skipped: it can hold the documents as they were before a change made by an
 * API route (an import deletes the canned greeting and posts a welcome), and
 * writing it would show that old state. The API fetch behind useMessages
 * supplies the first data and server snapshots follow. includeMetadataChanges
 * makes the SDK raise a snapshot when the listener switches from cache to
 * server, even when no document differs, so the first server answer is never
 * swallowed with the cached one. Nothing is written from the browser (every
 * write goes through an API route), so no snapshot carries a pending local write.
 */
export function useRealtimeMessages(sessionId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!sessionId) return

    const q = query(
      collection(db, 'messages'),
      where('session_id', '==', sessionId),
      orderBy('created_at', 'asc'),
    )

    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) return
      const messages: Message[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Message[]
      queryClient.setQueryData(['messages', sessionId], messages)
    })

    return unsubscribe
  }, [sessionId, queryClient])
}
