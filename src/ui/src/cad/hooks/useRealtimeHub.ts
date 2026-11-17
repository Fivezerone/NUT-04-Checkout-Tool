/**
 * src/ui/src/cad/hooks/useRealtimeHub.ts
 *
 * Real-Time Event Stream Consumer & CAD Reducer (Blueprint §3.6, ADR-2, F-07)
 * Flag: ns.sse (default false)
 *
 * Invariants:
 * - Application-level sequence IDs: `${epoch}:${seq}`.
 * - Idempotent event processing: ignores already-applied sequence numbers.
 * - Gap detection: triggers snapshot resync on missed sequences.
 * - Automatic exponential backoff with full jitter (1s - 30s cap).
 * - Fallback to 10s polling when ns.sse is disabled or after 2 failed reconnects.
 * - Zero patient PII logged or stored.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { isCadFlagEnabled } from '../flags'

export interface StreamEvent {
  id: string
  event: string
  payload: any
  timestamp?: number
}

export interface UseRealtimeHubOptions {
  scope?: string
  enabled?: boolean
  onEvent?: (event: StreamEvent) => void
  onResyncRequired?: () => void
  onAccessRevoked?: (scope: string) => void
  customFetch?: typeof fetch
}

export interface UseRealtimeHubResult {
  isConnected: boolean
  isPolling: boolean
  lastEventId: string | null
  resyncCount: number
  error: Error | null
  resync: () => Promise<void>
}

export function useRealtimeHub({
  scope = 'tenant',
  enabled = true,
  onEvent,
  onResyncRequired,
  onAccessRevoked,
  customFetch,
}: UseRealtimeHubOptions = {}): UseRealtimeHubResult {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isPolling, setIsPolling] = useState<boolean>(false)
  const [lastEventId, setLastEventId] = useState<string | null>(null)
  const [resyncCount, setResyncCount] = useState<number>(0)
  const [error, setError] = useState<Error | null>(null)

  const lastProcessedRef = useRef<{ epoch: number; seq: number }>({ epoch: 1, seq: 0 })
  const abortControllerRef = useRef<AbortController | null>(null)
  const reconnectAttemptRef = useRef<number>(0)
  const consecutiveFailuresRef = useRef<number>(0)
  const pollTimerRef = useRef<any>(null)

  const fetchFn = customFetch || (typeof fetch !== 'undefined' ? fetch : null)

  const resync = useCallback(async () => {
    if (!fetchFn) return
    try {
      const res = await fetchFn(`/v1/sync/snapshot?scope=${encodeURIComponent(scope)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const snapshot = await res.json()
        if (snapshot.latest_id) {
          const [epochStr, seqStr] = snapshot.latest_id.split(':')
          lastProcessedRef.current = {
            epoch: parseInt(epochStr, 10) || 1,
            seq: parseInt(seqStr, 10) || 0,
          }
          setLastEventId(snapshot.latest_id)
        }
        setResyncCount((prev) => prev + 1)
        onResyncRequired?.()
      }
    } catch (err: any) {
      console.warn('[RealtimeHub] Resync error:', err)
    }
  }, [fetchFn, scope, onResyncRequired])

  const processEvent = useCallback(
    (event: StreamEvent) => {
      if (!event.id) {
        // Control messages without id (e.g. resync_required or access_revoked)
        if (event.event === 'resync_required') {
          void resync()
        } else if (event.event === 'access_revoked') {
          onAccessRevoked?.(scope)
        }
        return
      }

      const [epochStr, seqStr] = event.id.split(':')
      const epoch = parseInt(epochStr, 10)
      const seq = parseInt(seqStr, 10)

      if (isNaN(epoch) || isNaN(seq)) {
        return
      }

      const current = lastProcessedRef.current

      // Idempotency check: ignore already applied sequence
      if (epoch === current.epoch && seq <= current.seq) {
        return
      }

      // Gap detection: missed events -> trigger resync
      if (epoch === current.epoch && seq > current.seq + 1) {
        console.warn(`[RealtimeHub] Gap detected: expected ${current.seq + 1}, received ${seq}. Triggering resync.`)
        void resync()
        return
      }

      // Update cursor
      lastProcessedRef.current = { epoch, seq }
      setLastEventId(event.id)

      if (event.event === 'resync_required') {
        void resync()
      } else if (event.event === 'access_revoked') {
        onAccessRevoked?.(scope)
      } else {
        onEvent?.(event)
      }
    },
    [resync, onEvent, onAccessRevoked, scope],
  )

  // Polling fallback loop
  const pollSync = useCallback(async () => {
    if (!fetchFn) return
    try {
      const sinceParam = lastEventId ? `&since=${encodeURIComponent(lastEventId)}` : ''
      const res = await fetchFn(`/v1/sync?scope=${encodeURIComponent(scope)}${sinceParam}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        throw new Error(`Sync poll HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.resync_required) {
        void resync()
      } else if (Array.isArray(data.events)) {
        for (const ev of data.events) {
          processEvent({
            id: ev.id,
            event: ev.event,
            payload: ev.payload,
            timestamp: ev.timestamp,
          })
        }
      }
      if (data.latest_id) {
        setLastEventId(data.latest_id)
      }
      consecutiveFailuresRef.current = 0
    } catch (err: any) {
      setError(err)
    }
  }, [fetchFn, scope, lastEventId, resync, processEvent])

  useEffect(() => {
    if (!enabled || !fetchFn) {
      setIsConnected(false)
      setIsPolling(false)
      return
    }

    let isSubscribed = true
    const sseActive = isCadFlagEnabled('ns.sse')

    // If SSE is off or 2 consecutive failures occurred, run polling fallback
    if (!sseActive || consecutiveFailuresRef.current >= 2) {
      setIsPolling(true)
      setIsConnected(false)

      void pollSync()
      pollTimerRef.current = setInterval(() => {
        if (isSubscribed) {
          void pollSync()
        }
      }, 10000)

      return () => {
        isSubscribed = false
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current)
          pollTimerRef.current = null
        }
      }
    }

    // Connect via SSE stream
    setIsPolling(false)
    abortControllerRef.current = new AbortController()

    const connectSse = async () => {
      try {
        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
        }
        if (lastProcessedRef.current.seq > 0) {
          headers['Last-Event-ID'] = `${lastProcessedRef.current.epoch}:${lastProcessedRef.current.seq}`
        }

        const response = await fetchFn(`/v1/events?scope=${encodeURIComponent(scope)}`, {
          method: 'GET',
          headers,
          credentials: 'same-origin',
          signal: abortControllerRef.current?.signal,
        })

        if (!response.ok) {
          throw new Error(`SSE stream HTTP ${response.status}`)
        }

        if (!isSubscribed) return

        setIsConnected(true)
        setError(null)
        reconnectAttemptRef.current = 0
        consecutiveFailuresRef.current = 0

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('ReadableStream getReader not supported')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (isSubscribed) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''

          for (const block of blocks) {
            if (!block.trim() || block.startsWith(':')) continue // Ignore empty or comment lines

            const lines = block.split('\n')
            let eventType = 'message'
            let eventId = ''
            let dataStr = ''

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim()
              } else if (line.startsWith('id:')) {
                eventId = line.slice(3).trim()
              } else if (line.startsWith('data:')) {
                dataStr = line.slice(5).trim()
              }
            }

            let payload: any = {}
            try {
              if (dataStr) payload = JSON.parse(dataStr)
            } catch {
              payload = dataStr
            }

            processEvent({
              id: eventId,
              event: eventType,
              payload,
            })
          }
        }
      } catch (err: any) {
        if (!isSubscribed) return
        setIsConnected(false)
        consecutiveFailuresRef.current += 1
        setError(err)

        if (consecutiveFailuresRef.current >= 2) {
          // Fall back to polling
          setIsPolling(true)
          void pollSync()
          pollTimerRef.current = setInterval(() => {
            if (isSubscribed) void pollSync()
          }, 10000)
          return
        }

        // Full jitter exponential backoff (1s - 30s)
        const attempt = reconnectAttemptRef.current++
        const baseDelay = Math.min(30000, 1000 * Math.pow(2, attempt))
        const jitteredDelay = baseDelay * (0.5 + Math.random() * 0.5)

        setTimeout(() => {
          if (isSubscribed) {
            void connectSse()
          }
        }, jitteredDelay)
      }
    }

    void connectSse()

    return () => {
      isSubscribed = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [enabled, fetchFn, scope, pollSync, processEvent])

  return {
    isConnected,
    isPolling,
    lastEventId,
    resyncCount,
    error,
    resync,
  }
}
