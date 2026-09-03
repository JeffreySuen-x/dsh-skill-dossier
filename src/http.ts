/** Shared JSON-over-HTTP helpers for the manager and report APIs. */

export async function readJsonBody(req: any, maxBytes: number): Promise<unknown> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > maxBytes) throw new Error('请求体过大')
  }
  return body === '' ? {} : JSON.parse(body)
}

export function respondJson(res: any, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/** Reject browser requests originating from another site. */
export function isCrossSiteRequest(req: any): boolean {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return true
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return false
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return true
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}
