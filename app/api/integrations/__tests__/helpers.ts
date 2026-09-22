export const SECRET = 'test-secret-value-not-real'
export const integrationHeaders = {
  'X-Integration-Secret': SECRET,
  'X-Integration-Namespace': 'stars-demo',
  'Content-Type': 'application/json',
}
export const UUID = '123e4567-e89b-42d3-a456-426614174000'
export const UUID2 = '223e4567-e89b-42d3-a456-426614174000'

type Handler = (request: Request) => Promise<Response>

export function postJson(
  handler: Handler,
  path: string,
  body: unknown,
  headers: Record<string, string> = integrationHeaders
) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

export function getWith(handler: Handler, path: string, headers: Record<string, string> = integrationHeaders) {
  return handler(new Request(`http://localhost${path}`, { headers }))
}

export async function errorCode(res: Response): Promise<string> {
  return (await res.json()).error?.code
}
