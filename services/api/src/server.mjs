// services/api/src/server.mjs
// Lightweight Node HTTP server for the NUT-04 ported API service.
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 4000)

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health' || url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'nutriscore-api',
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ message: 'NutriScore API Service', endpoint: url.pathname }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] NutriScore API service listening on port ${PORT}`)
})
