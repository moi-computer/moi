export class HttpError extends Error {
  readonly status: number
  readonly machineState: string | null

  constructor(response: Response, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = response.status
    this.machineState =
      response.status === 503 && response.url.startsWith(`${globalThis.location?.origin}/api/`)
        ? response.headers.get('X-Moi-Machine-State')
        : null
  }
}

async function errorFrom(response: Response, fallback: string) {
  const detail = await response.text()
  return new HttpError(response, detail || fallback)
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  error = 'Request failed'
) {
  const response = await fetch(input, init)
  if (!response.ok) throw await errorFrom(response, error)
  return response.json() as Promise<T>
}

export async function requestVoid(
  input: RequestInfo | URL,
  init?: RequestInit,
  error = 'Request failed'
) {
  const response = await fetch(input, init)
  if (!response.ok) throw await errorFrom(response, error)
}

export function jsonRequest(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown
): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }
}
