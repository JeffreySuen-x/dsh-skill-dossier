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

const MAX_BODY_BYTES = 1024 * 1024

/** 一条 JSON-RPC 路由的处理表：方法名 → 处理函数。 */
export type RpcHandlers = Record<string, (args: any) => unknown>

/**
 * 两个 API（`/api/skill-manager`、`/api/report`）共用的路由骨架：只接受 POST、
 * 拒跨站、限体积、按 `{ method, args }` 派发、统一包错误。
 *
 * 收成一处不是为了少几行，而是**安全边界只能有一个实现**——同源校验曾经在
 * 两个路由里各写一遍，结果一个 403、一个 200（2026-09-03 修）。
 */
export function createRpcRoute(options: {
  handlers: RpcHandlers
  /** 派发前钩子（如按 sessionId 建目录），抛错即整个请求失败。 */
  before?: (args: any) => Promise<void> | void
}): (req: any, res: any) => Promise<void> {
  const { handlers, before } = options
  return async (req: any, res: any): Promise<void> => {
    try {
      if (req.method !== 'POST') { respondJson(res, 405, { error: 'method not allowed' }); return }
      if (isCrossSiteRequest(req)) { respondJson(res, 403, { error: '跨站请求被拒绝' }); return }
      let body: any
      try {
        body = await readJsonBody(req, MAX_BODY_BYTES)
      } catch (error) {
        respondJson(res, 400, { error: `请求体无效：${errorMessage(error)}` })
        return
      }
      const method = body?.method
      if (typeof method !== 'string') { respondJson(res, 400, { error: '缺少 method 字段' }); return }
      const handler = handlers[method]
      if (handler === undefined) { respondJson(res, 404, { error: `未知方法：${method}` }); return }
      const args = body?.args
      if (before !== undefined) await before(args)
      respondJson(res, 200, await handler(args))
    } catch (error) {
      respondJson(res, 500, { error: errorMessage(error) })
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
