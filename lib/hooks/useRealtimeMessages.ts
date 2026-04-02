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

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages: Message[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Message[]
      queryClient.setQueryData(['messages', sessionId], messages)
    })

    return unsubscribe
  }, [sessionId, queryClient])
}
