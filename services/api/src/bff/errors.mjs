// services/api/src/bff/errors.mjs
// RFC 9457 Problem Details error formatter for the NutriScore BFF.
// Reference: Blueprint §3.5, §4.3.

export function createProblemDetails({
  type = 'about:blank',
  title,
  status = 500,
  code = 'INTERNAL_ERROR',
  traceId = 'trace-unknown',
  detail,
  retryAfter,
}) {
  const problem = {
    type,
    title: title || (status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Error'),
    status,
    code,
    trace_id: traceId,
  }

  if (detail) {
    problem.detail = detail
  }
  if (typeof retryAfter === 'number') {
    problem.retry_after_s = retryAfter
  }

  return problem
}

export function sendProblem(res, params) {
  const problem = createProblemDetails(params)
  const headers = { 'Content-Type': 'application/problem+json' }
  if (params.retryAfter) {
    headers['Retry-After'] = String(params.retryAfter)
  }
  res.writeHead(problem.status, headers)
  res.end(JSON.stringify(problem))
}
