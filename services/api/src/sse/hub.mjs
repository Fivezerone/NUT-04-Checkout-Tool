/**
 * services/api/src/sse/hub.mjs
 *
 * Real-Time Hub for CAD Server-Sent Events (SSE) (Blueprint §3.6, ADR-2, F-07, G-06)
 *
 * Key Architectural Invariants:
 * - One-way SSE stream over HTTP/2 with application-level sequence IDs: `${epoch}:${seq}`.
 * - Gapless monotonic sequence per scope (tenant, or tenant + patient_ref).
 * - Replay buffer of 10 minutes or 5,000 events per scope for Last-Event-ID resume.
 * - Heartbeat comment (:keepalive) every 15 seconds to prevent intermediary timeouts.
 * - Bounded queue of 256 events per connection with patient.alert coalescing on backpressure.
 * - Tri-state synchronization: full stream, resync_required (snapshot fetch), access_revoked.
 * - Zero patient PII or unmasked clinical data in stream payloads.
 */

import { sendProblem } from '../bff/errors.mjs'

export const REPLAY_TTL_MS = 10 * 60 * 1000 // 10 minutes
export const REPLAY_MAX_EVENTS = 5000
export const CONNECTION_QUEUE_MAX = 256
export const HEARTBEAT_INTERVAL_MS = 15000 // 15 seconds

export class RealtimeHub {
  constructor(options = {}) {
    this.replayTtlMs = options.replayTtlMs ?? REPLAY_TTL_MS
    this.replayMaxEvents = options.replayMaxEvents ?? REPLAY_MAX_EVENTS
    this.connectionQueueMax = options.connectionQueueMax ?? CONNECTION_QUEUE_MAX
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS

    // Map: connectionId -> ConnectionContext
    this.connections = new Map()

    // Map: `${tenantId}:${scope}` -> Array of buffered events
    this.replayBuffers = new Map()

    // Map: `${tenantId}:${scope}` -> { epoch: number, seq: number }
    this.cursors = new Map()

    // State snapshots per tenant/scope for snapshot resync
    this.snapshots = new Map()
  }

  getScopeKey(tenantId, scope = 'tenant') {
    return `${tenantId}:${scope}`
  }

  getCursor(tenantId, scope = 'tenant') {
    const key = this.getScopeKey(tenantId, scope)
    if (!this.cursors.has(key)) {
      this.cursors.set(key, { epoch: 1, seq: 0 })
    }
    return this.cursors.get(key)
  }

  setCursor(tenantId, scope = 'tenant', epoch, seq) {
    const key = this.getScopeKey(tenantId, scope)
    this.cursors.set(key, { epoch: Number(epoch), seq: Number(seq) })
  }

  /**
   * Updates state snapshot for a scope
   */
  updateSnapshot(tenantId, scope = 'tenant', stateUpdater) {
    const key = this.getScopeKey(tenantId, scope)
    const current = this.snapshots.get(key) || {}
    const updated = typeof stateUpdater === 'function' ? stateUpdater(current) : stateUpdater
    this.snapshots.set(key, updated)
  }

  getSnapshot(tenantId, scope = 'tenant') {
    const key = this.getScopeKey(tenantId, scope)
    const cursor = this.getCursor(tenantId, scope)
    return {
      tenant_id: tenantId,
      scope,
      latest_id: `${cursor.epoch}:${cursor.seq}`,
      epoch: cursor.epoch,
      seq: cursor.seq,
      data: this.snapshots.get(key) || {},
    }
  }

  /**
   * Publishes a real-time event to the hub
   */
  publishEvent({ tenantId, scope = 'tenant', eventType, payload = {}, audience = 'all' }) {
    if (!tenantId) {
      throw new Error('publishEvent: tenantId is required')
    }
    if (!eventType) {
      throw new Error('publishEvent: eventType is required')
    }

    const cursor = this.getCursor(tenantId, scope)
    cursor.seq += 1
    const eventId = `${cursor.epoch}:${cursor.seq}`

    const event = {
      id: eventId,
      epoch: cursor.epoch,
      seq: cursor.seq,
      tenantId,
      scope,
      eventType,
      payload,
      audience,
      timestamp: Date.now(),
    }

    // Buffer in replay window
    const key = this.getScopeKey(tenantId, scope)
    if (!this.replayBuffers.has(key)) {
      this.replayBuffers.set(key, [])
    }
    const buffer = this.replayBuffers.get(key)
    buffer.push(event)

    // Trim replay buffer (TTL and Max Count)
    const cutoff = Date.now() - this.replayTtlMs
    while (
      buffer.length > 0 &&
      (buffer[0].timestamp < cutoff || buffer.length > this.replayMaxEvents)
    ) {
      buffer.shift()
    }

    // Broadcast to active connections
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.tenantId !== tenantId) {
        continue
      }
      if (conn.scope !== scope && conn.scope !== '*' && scope !== 'tenant') {
        continue
      }

      // Check audience filtering
      if (audience !== 'all') {
        const allowedRoles = Array.isArray(audience) ? audience : [audience]
        if (!allowedRoles.includes(conn.appRole)) {
          continue
        }
      }

      this.enqueueForConnection(connId, event)
    }

    return event
  }

  /**
   * Enqueues an event for a specific connection with backpressure and coalescing
   */
  enqueueForConnection(connId, event) {
    const conn = this.connections.get(connId)
    if (!conn || conn.closed) return

    conn.queue.push(event)

    // Check backpressure ceiling
    if (conn.queue.length >= this.connectionQueueMax) {
      // Coalesce patient.alert events by patient_ref (latest wins)
      const alerts = new Map()
      const nonAlerts = []

      for (const item of conn.queue) {
        if (item.eventType === 'patient.alert' && item.payload?.patient_ref) {
          alerts.set(item.payload.patient_ref, item)
        } else {
          nonAlerts.push(item)
        }
      }

      conn.queue = [...nonAlerts, ...alerts.values()]

      // If still exceeding bounded queue, trigger resync_required and close connection
      if (conn.queue.length > this.connectionQueueMax) {
        this.sendSseMessage(conn.res, 'resync_required', {
          reason: 'queue_overflow',
          dropped: conn.queue.length,
        })
        this.closeConnection(connId)
        return
      }
    }

    this.drainConnectionQueue(connId)
  }

  drainConnectionQueue(connId) {
    const conn = this.connections.get(connId)
    if (!conn || conn.closed || conn.draining) return

    conn.draining = true
    try {
      while (conn.queue.length > 0 && !conn.closed) {
        const event = conn.queue.shift()
        this.sendSseEvent(conn.res, event)
      }
    } finally {
      if (conn) {
        conn.draining = false
      }
    }
  }

  sendSseEvent(res, event) {
    if (res.writableEnded || res.destroyed) return
    const lines = [
      `id: ${event.id}`,
      `event: ${event.eventType}`,
      `data: ${JSON.stringify(event.payload)}`,
      '',
      '',
    ]
    res.write(lines.join('\n'))
  }

  sendSseMessage(res, eventType, data = {}) {
    if (res.writableEnded || res.destroyed) return
    const lines = [`event: ${eventType}`, `data: ${JSON.stringify(data)}`, '', '']
    res.write(lines.join('\n'))
  }

  sendHeartbeat(res) {
    if (res.writableEnded || res.destroyed) return
    res.write(':keepalive\n\n')
  }

  /**
   * Retrieves events from replay buffer after a specific cursor
   */
  getReplayEvents(tenantId, scope, sinceEpoch, sinceSeq) {
    const key = this.getScopeKey(tenantId, scope)
    const buffer = this.replayBuffers.get(key) || []
    if (buffer.length === 0) return []

    // If sinceEpoch is different from buffer epoch, or sinceSeq is older than buffer head
    const head = buffer[0]
    if (sinceEpoch !== head.epoch) {
      return null // Incompatible epoch -> requires full resync
    }
    if (sinceSeq < head.seq - 1) {
      return null // Gap before buffer head -> requires full resync
    }

    return buffer.filter((e) => e.epoch === sinceEpoch && e.seq > sinceSeq)
  }

  /**
   * Handles incoming SSE Connection (GET /v1/events)
   */
  handleSseConnection(req, res, session, options = {}) {
    if (!session) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHENTICATED',
        detail: 'Authentication required for real-time event stream',
      })
      return
    }

    const tenantId = session.tenant_id
    const appRole = session.app_role
    const scope = options.scope || 'tenant'

    // Set standard SSE streaming headers (Blueprint §3.6, ADR-2)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering (Nginx/Caddy)
    })

    const connId = `sse_${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const connectionContext = {
      id: connId,
      tenantId,
      appRole,
      scope,
      res,
      queue: [],
      draining: false,
      closed: false,
      timer: null,
    }

    this.connections.set(connId, connectionContext)

    // Schedule 15s heartbeat
    connectionContext.timer = setInterval(() => {
      this.sendHeartbeat(res)
    }, this.heartbeatIntervalMs)

    // Handle Last-Event-ID resume
    const lastEventId =
      req.headers['last-event-id'] ||
      options.lastEventId ||
      new URL(req.url, 'http://localhost').searchParams.get('last_event_id')

    if (lastEventId) {
      const parts = String(lastEventId).split(':')
      if (parts.length === 2) {
        const sinceEpoch = parseInt(parts[0], 10)
        const sinceSeq = parseInt(parts[1], 10)

        if (!isNaN(sinceEpoch) && !isNaN(sinceSeq)) {
          const replay = this.getReplayEvents(tenantId, scope, sinceEpoch, sinceSeq)
          if (replay === null) {
            // Buffer expired or gap detected -> emit resync_required
            this.sendSseMessage(res, 'resync_required', {
              reason: 'gap_detected_or_expired',
              since: lastEventId,
            })
          } else {
            // Replay all missed events in sequence order
            for (const ev of replay) {
              this.sendSseEvent(res, ev)
            }
          }
        }
      }
    } else {
      // New connection without Last-Event-ID: send initial ready event
      const cursor = this.getCursor(tenantId, scope)
      this.sendSseMessage(res, 'ready', {
        cursor: `${cursor.epoch}:${cursor.seq}`,
        tenant_id: tenantId,
        scope,
      })
    }

    // Clean up on disconnect
    req.on('close', () => {
      this.closeConnection(connId)
    })
    res.on('close', () => {
      this.closeConnection(connId)
    })

    return connId
  }

  closeConnection(connId) {
    const conn = this.connections.get(connId)
    if (!conn) return

    conn.closed = true
    if (conn.timer) {
      clearInterval(conn.timer)
      conn.timer = null
    }
    this.connections.delete(connId)
  }

  /**
   * Handles polling fallback: GET /v1/sync?since=<id>&scope=<scope>
   */
  handlePollingSync(req, res, session) {
    if (!session) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHENTICATED',
        detail: 'Authentication required for sync polling',
      })
      return
    }

    const url = new URL(req.url, 'http://localhost')
    const tenantId = session.tenant_id
    const scope = url.searchParams.get('scope') || 'tenant'
    const since = url.searchParams.get('since')

    const cursor = this.getCursor(tenantId, scope)
    const latestId = `${cursor.epoch}:${cursor.seq}`

    if (!since) {
      // Initial poll returns latest cursor
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          events: [],
          latest_id: latestId,
          resync_required: false,
        }),
      )
      return
    }

    const [epochStr, seqStr] = since.split(':')
    const sinceEpoch = parseInt(epochStr, 10)
    const sinceSeq = parseInt(seqStr, 10)

    if (isNaN(sinceEpoch) || isNaN(sinceSeq)) {
      sendProblem(res, {
        status: 400,
        code: 'INVALID_CURSOR',
        detail: 'since query parameter must be formatted as ${epoch}:${seq}',
      })
      return
    }

    const replay = this.getReplayEvents(tenantId, scope, sinceEpoch, sinceSeq)

    if (replay === null) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          events: [],
          latest_id: latestId,
          resync_required: true,
        }),
      )
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        events: replay.map((e) => ({
          id: e.id,
          event: e.eventType,
          payload: e.payload,
          timestamp: e.timestamp,
        })),
        latest_id: latestId,
        resync_required: false,
      }),
    )
  }

  /**
   * Handles snapshot fetch: GET /v1/sync/snapshot
   */
  handleSnapshot(req, res, session) {
    if (!session) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHENTICATED',
        detail: 'Authentication required for state snapshot',
      })
      return
    }

    const url = new URL(req.url, 'http://localhost')
    const tenantId = session.tenant_id
    const scope = url.searchParams.get('scope') || 'tenant'

    const snapshot = this.getSnapshot(tenantId, scope)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(snapshot))
  }
}
