// services/api/src/server.mjs
// Lightweight Node.js HTTP server for the NUT-04 ported API service.
// Hosts Telemetry Gateway, Consent Register & BFF routes with PDP enforcement.
// References: Golden Path 1; Blueprint §3.3 (N3), §3.5 (N5), §3.7 (N7), §3.9 (N9).

import { createServer } from 'node:http'
import { defaultStore, TelemetryStore } from './store.mjs'
import { ConsentRegisterService } from './consent-register.mjs'
import { TelemetryGatewayService } from './telemetry-gateway.mjs'
import { SessionManager } from './bff/session.mjs'
import { computeCapabilitiesForSubject } from './bff/capabilities.mjs'
import { maskObject } from './bff/masks.mjs'
import { verifyAuditLedger, computeRowHash } from './audit/verifier.mjs'
import { sendProblem } from './bff/errors.mjs'
import { RealtimeHub } from './sse/hub.mjs'

export function createApiApp(options = {}) {
  const store = options.store || defaultStore || new TelemetryStore()
  const consentService = options.consentService || new ConsentRegisterService(store)
  const gatewayService =
    options.gatewayService || new TelemetryGatewayService(store, consentService)
  const sessionManager = options.sessionManager || new SessionManager(store)
  const realtimeHub = options.realtimeHub || new RealtimeHub()

  // In-memory audit entries for testing and verification
  const auditEntries = options.auditEntries || []
  const auditRoots = options.auditRoots || []

  const requestListener = async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // -------------------------------------------------------------------------
    // Health probes & System Status
    // -------------------------------------------------------------------------
    if (pathname === '/health' || pathname === '/healthz' || pathname === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'nutriscore-api',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        }),
      )
      return
    }

    // RED Metrics
    if (pathname === '/v1/metrics' || pathname === '/api/v1/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          metrics: gatewayService.metrics,
          bronze_count: store.getBronzeCount ? store.getBronzeCount() : 0,
          shadow_count: store.getShadowCount ? store.getShadowCount() : 0,
          timestamp: new Date().toISOString(),
        }),
      )
      return
    }

    // -------------------------------------------------------------------------
    // Telemetry Batch Ingestion: POST /v1/telemetry/batch
    // -------------------------------------------------------------------------
    if (
      (pathname === '/v1/telemetry/batch' || pathname === '/api/v1/telemetry/batch') &&
      req.method === 'POST'
    ) {
      return new Promise((resolve) => {
        let rawBody = ''
        req.on('data', (chunk) => {
          rawBody += chunk
        })
        req.on('end', async () => {
          try {
            const result = await gatewayService.handleBatch(rawBody, req.headers)
            const headers = { 'Content-Type': 'application/json' }
            if (result.cached) {
              headers['X-Cache'] = 'HIT'
            }
            res.writeHead(result.status || 200, headers)
            res.end(JSON.stringify(result.body))
          } catch (err) {
            const status = err.statusCode || 500
            const headers = { 'Content-Type': 'application/json' }
            if (err.retryAfter) {
              headers['Retry-After'] = String(err.retryAfter)
            }
            res.writeHead(status, headers)
            res.end(
              JSON.stringify({
                error: err.message || 'Internal Server Error',
                code: err.code || 'INTERNAL_ERROR',
              }),
            )
          } finally {
            resolve()
          }
        })
      })
    }

    // -------------------------------------------------------------------------
    // Consent Register Routes
    // -------------------------------------------------------------------------
    if (
      (pathname === '/v1/consent/register' || pathname === '/api/v1/consent/register') &&
      req.method === 'POST'
    ) {
      return new Promise((resolve) => {
        let rawBody = ''
        req.on('data', (chunk) => {
          rawBody += chunk
        })
        req.on('end', async () => {
          try {
            const body = JSON.parse(rawBody)
            const registered = await consentService.registerConsent(body)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, consent: registered }))
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          } finally {
            resolve()
          }
        })
      })
    }

    if (
      (pathname === '/v1/consent/revoke' || pathname === '/api/v1/consent/revoke') &&
      req.method === 'POST'
    ) {
      return new Promise((resolve) => {
        let rawBody = ''
        req.on('data', (chunk) => {
          rawBody += chunk
        })
        req.on('end', async () => {
          try {
            const body = JSON.parse(rawBody)
            const revoked = await consentService.revokeConsent(body.consent_ref, body.revoked_at)
            if (!revoked) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Consent record not found' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, consent: revoked }))
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          } finally {
            resolve()
          }
        })
      })
    }

    if (
      (pathname.startsWith('/v1/consent/') || pathname.startsWith('/api/v1/consent/')) &&
      req.method === 'GET'
    ) {
      const parts = pathname.split('/')
      const consentRef = parts[parts.length - 1]
      try {
        const consent = await consentService.getConsent(consentRef)
        if (!consent) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Consent record not found' }))
          return
        }
        const active = await consentService.hasActiveConsent(consentRef, 'C2')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, consent, active }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // -------------------------------------------------------------------------
    // BFF Authentication & Session Routes (ADR-004, F-01, F-02)
    // -------------------------------------------------------------------------
    if (
      (pathname === '/v1/auth/session' || pathname === '/api/v1/auth/session') &&
      req.method === 'POST'
    ) {
      return new Promise((resolve) => {
        let rawBody = ''
        req.on('data', (chunk) => {
          rawBody += chunk
        })
        req.on('end', async () => {
          try {
            const body = JSON.parse(rawBody)
            const session = await sessionManager.createSession({
              userId: body.userId || body.user_id,
              tenantId: body.tenantId || body.tenant_id,
              appRole: body.appRole || body.app_role,
              acr: body.acr ?? 1,
              amr: body.amr ?? [],
              encryptedTokens: body.encryptedTokens ?? {},
            })

            const setCookie = sessionManager.createSetCookieHeader(session.sid)
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': setCookie,
            })
            res.end(
              JSON.stringify({
                ok: true,
                csrf_token: session.csrf_secret,
                role: session.app_role,
                tenant_id: session.tenant_id,
              }),
            )
          } catch (err) {
            sendProblem(res, {
              status: 400,
              code: 'INVALID_CREDENTIALS',
              detail: err.message,
            })
          } finally {
            resolve()
          }
        })
      })
    }

    if (
      (pathname === '/v1/auth/logout' || pathname === '/api/v1/auth/logout') &&
      req.method === 'POST'
    ) {
      const sid = sessionManager.parseSessionCookie(req.headers.cookie)
      if (sid) {
        await sessionManager.revokeSession(sid)
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionManager.createClearCookieHeader(),
      })
      res.end(JSON.stringify({ ok: true, message: 'Session logged out' }))
      return
    }

    // -------------------------------------------------------------------------
    // Session Verification Middleware for Protected Routes
    // -------------------------------------------------------------------------
    const sid = sessionManager.parseSessionCookie(req.headers.cookie)
    const currentSession = sid ? await sessionManager.getSession(sid) : null

    // Helper: Require authenticated BFF session
    const requireBffSession = () => {
      if (!currentSession) {
        sendProblem(res, {
          status: 401,
          code: 'UNAUTHORIZED',
          title: 'Unauthorized',
          detail: 'Valid __Host-ns_sid session cookie required',
        })
        return null
      }
      // CSRF check on state-mutating methods
      const csrfCheck = sessionManager.validateCsrf(req, currentSession)
      if (!csrfCheck.valid) {
        sendProblem(res, {
          status: 403,
          code: 'CSRF_INVALID',
          title: 'Forbidden',
          detail: csrfCheck.reason,
        })
        return null
      }
      return currentSession
    }

    // -------------------------------------------------------------------------
    // Capabilities Endpoint: GET /v1/capabilities (Blueprint §3.5, §4.1)
    // -------------------------------------------------------------------------
    if (
      (pathname === '/v1/capabilities' || pathname === '/api/v1/capabilities') &&
      req.method === 'GET'
    ) {
      const session = requireBffSession()
      if (!session) return

      const capsResponse = computeCapabilitiesForSubject({
        role: session.app_role,
        acr: session.acr,
        tenantId: session.tenant_id,
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(capsResponse))
      return
    }

    // -------------------------------------------------------------------------
    // Audit Ledger Verifier: GET /v1/audit/verify (Blueprint §3.7, F-05)
    // -------------------------------------------------------------------------
    if (
      (pathname === '/v1/audit/verify' || pathname === '/api/v1/audit/verify') &&
      req.method === 'GET'
    ) {
      const session = requireBffSession()
      if (!session) return

      const verification = verifyAuditLedger(auditEntries, auditRoots)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(verification))
      return
    }

    // -------------------------------------------------------------------------
    // Protected Mock Resource: Patient Directory (with Field Masking)
    // -------------------------------------------------------------------------
    if ((pathname === '/v1/patients' || pathname === '/api/v1/patients') && req.method === 'GET') {
      const session = requireBffSession()
      if (!session) return

      // Delta D-4: super_admin has zero clinical visibility
      if (session.app_role === 'super_admin') {
        sendProblem(res, {
          status: 403,
          code: 'ACCESS_DENIED',
          detail: 'super_admin is prohibited from clinical patient directory access',
        })
        return
      }

      const samplePatients = [
        {
          id: 'p-001',
          patient_ref: 'pat-ref-001',
          display_name: 'Patient Alpha',
          care_team: ['dr-smith'],
          consent_status: 'active',
          active_targets: { sodium_max: 2000 },
          internal_diagnosis: 'REDACTED_CONDITION', // Must NEVER leak!
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ]

      const masked = maskObject('patient_directory', session.app_role, samplePatients)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: masked }))
      return
    }

    // -------------------------------------------------------------------------
    // Real-Time Hub & SSE Streaming Routes (N6, F-07, G-06; ADR-2)
    // -------------------------------------------------------------------------
    if ((pathname === '/v1/events' || pathname === '/api/v1/events') && req.method === 'GET') {
      const session = requireBffSession()
      if (!session) return
      realtimeHub.handleSseConnection(req, res, session)
      return
    }

    if ((pathname === '/v1/sync' || pathname === '/api/v1/sync') && req.method === 'GET') {
      const session = requireBffSession()
      if (!session) return
      realtimeHub.handlePollingSync(req, res, session)
      return
    }

    if (
      (pathname === '/v1/sync/snapshot' || pathname === '/api/v1/sync/snapshot') &&
      req.method === 'GET'
    ) {
      const session = requireBffSession()
      if (!session) return
      realtimeHub.handleSnapshot(req, res, session)
      return
    }

    // Default 404
    sendProblem(res, {
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      title: 'Not Found',
      detail: `No handler mounted for path: ${pathname}`,
    })
  }

  const server = createServer(requestListener)
  return {
    server,
    store,
    consentService,
    gatewayService,
    sessionManager,
    realtimeHub,
    auditEntries,
    auditRoots,
    requestListener,
  }
}

// Standalone execution when started via `node src/server.mjs`
const isMain = process.argv[1] && process.argv[1].endsWith('server.mjs')
if (isMain) {
  const PORT = Number(process.env.PORT || 4000)
  const { server } = createApiApp()

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] NutriScore API service listening on port ${PORT}`)
  })
}
