// services/api/src/server.mjs
// Lightweight Node.js HTTP server for the NUT-04 ported API service.
// Hosts Telemetry Gateway, Consent Register & BFF routes.
// References: Golden Path 1; Blueprint §3.3 (N3), §3.9 (N9).

import { createServer } from 'node:http'
import { defaultStore, TelemetryStore } from './store.mjs'
import { ConsentRegisterService } from './consent-register.mjs'
import { TelemetryGatewayService } from './telemetry-gateway.mjs'

export function createApiApp(options = {}) {
  const store = options.store || defaultStore || new TelemetryStore()
  const consentService = options.consentService || new ConsentRegisterService(store)
  const gatewayService =
    options.gatewayService || new TelemetryGatewayService(store, consentService)

  const requestListener = async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // Health probes
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

    // Telemetry Batch Ingestion: POST /v1/telemetry/batch
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

    // Consent Register: POST /v1/consent/register
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

    // Consent Revocation: POST /v1/consent/revoke
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

    // Consent Lookup: GET /v1/consent/:ref
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

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ message: 'NutriScore API Service: Route Not Found', endpoint: pathname }),
    )
  }

  const server = createServer(requestListener)
  return {
    server,
    store,
    consentService,
    gatewayService,
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
