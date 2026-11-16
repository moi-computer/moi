import { CONTROL_HOST, CONTROL_PORT } from '../constants'
import type { RemoteBroker, RemoteLogin, RemoteRequestOptions } from './client'
import { CloudSignInRequired } from './errors'

// The caller's side of broker.ts: hand a Cloud request to the Moi server
// running on this machine, which sends it with its own login. The caller
// never sees a credential.

export const BROKER_ERROR_HEADER = 'x-moi-broker-error'
export const BROKER_LOGIN_HEADER = 'x-moi-login'
// A header a web page cannot send across origins without a preflight, which
// the control server never answers. It keeps browsers out of the broker.
export const BROKER_CALLER_HEADER = 'x-moi-cli'

const notRunning = (error: unknown) =>
  ['ConnectionRefused', 'ECONNREFUSED'].includes(String((error as { code?: unknown })?.code))

export function createControlBroker(base: string): RemoteBroker {
  // No server, or one from before the broker existed, answers undefined.
  async function ask(
    route: string,
    options: RemoteRequestOptions = {}
  ): Promise<Response | undefined> {
    let response: Response
    try {
      response = await fetch(base + route, {
        method: options.method ?? 'GET',
        body: options.body,
        signal: options.signal,
        redirect: 'error',
        headers: {
          [BROKER_CALLER_HEADER]: '1',
          ...(options.contentType ? { 'content-type': options.contentType } : {})
        }
      })
    } catch (error) {
      if (notRunning(error)) return undefined
      throw error
    }
    if (response.headers.has(BROKER_ERROR_HEADER)) {
      const failure = (await response.json().catch(() => ({}))) as {
        error?: unknown
        signIn?: unknown
      }
      const message = typeof failure.error === 'string' ? failure.error : 'Moi refused the request'
      throw failure.signIn ? new CloudSignInRequired(message) : new Error(message)
    }
    if (!response.headers.has(BROKER_LOGIN_HEADER)) {
      await response.body?.cancel()
      return undefined
    }
    return response
  }

  return {
    async info() {
      const response = await ask('/remote/info')
      if (!response) return undefined
      const { url, login } = (await response.json()) as {
        url: string
        login?: RemoteLogin
      }
      return { url, login }
    },
    async fetch(path, options) {
      const response = await ask('/remote/request?path=' + encodeURIComponent(path), options)
      if (!response) return undefined
      return {
        response,
        agent: response.headers.get(BROKER_LOGIN_HEADER) === 'agent'
      }
    }
  }
}

export const controlBroker = createControlBroker(`http://${CONTROL_HOST}:${CONTROL_PORT}`)
