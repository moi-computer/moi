import type { WorkspaceEntry } from '@/lib/types'
import { DATA_DIR } from '../data-dir'
import { listWorkspaces } from '../workspaces/registry'
import { allowedCloudRequest } from './allowed'
import { BROKER_CALLER_HEADER, BROKER_ERROR_HEADER, BROKER_LOGIN_HEADER } from './broker-client'
import { createRemoteClient } from './client'
import { CloudSignInRequired } from './errors'

// The running server lends its Cloud login to callers on this machine that
// have none of their own, such as the agent's OS user on a managed machine
// (docs/config.md). It sends the request itself and passes the answer back,
// so the credential never leaves this process. Three checks bound what a
// caller can do with it:
//
// - the request must be on the list in allowed.ts
// - a request that names a workspace must name one linked on this machine
// - the caller must be a program, not a web page (see BROKER_CALLER_HEADER)

type BrokerClient = Pick<ReturnType<typeof createRemoteClient>, 'send' | 'loginInfo'>

const failure = (error: unknown, status: number) =>
  Response.json(
    {
      error: error instanceof Error ? error.message : 'Cloud request failed',
      signIn: error instanceof CloudSignInRequired
    },
    { status, headers: { [BROKER_ERROR_HEADER]: '1' } }
  )

export function createRemoteBroker(
  // This server's own login only: it never asks another server.
  client: BrokerClient = createRemoteClient(DATA_DIR),
  workspaces: () => Promise<WorkspaceEntry[]> = listWorkspaces
) {
  /** Answers undefined for a request that is not addressed to the broker. */
  return async function handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (url.pathname !== '/remote/info' && url.pathname !== '/remote/request') return undefined
    if (request.headers.get(BROKER_CALLER_HEADER) !== '1' || request.headers.has('origin'))
      return failure(new Error('Only the moi CLI can use this'), 403)
    try {
      if (url.pathname === '/remote/info') {
        const info = await client.loginInfo()
        return Response.json(info, {
          headers: { [BROKER_LOGIN_HEADER]: info.login ?? 'none' }
        })
      }
      const path = url.searchParams.get('path') ?? ''
      const { workspace } = allowedCloudRequest(request.method, path)
      if (
        workspace &&
        !(await workspaces()).some(
          entry =>
            entry.remote?.user_id === workspace.user_id &&
            entry.remote.workspace_id === workspace.workspace_id
        )
      )
        throw new Error('This workspace is not linked on this machine')
      const { response, agent } = await client.send(path, {
        method: request.method,
        // Sent whole so the upload keeps its length and an agent login can sign it.
        body: request.body ? await request.blob() : undefined,
        contentType: request.headers.get('content-type') ?? undefined,
        signal: request.signal
      })
      const contentType = response.headers.get('content-type')
      return new Response(response.body, {
        status: response.status,
        headers: {
          [BROKER_LOGIN_HEADER]: agent ? 'agent' : 'human',
          ...(contentType ? { 'content-type': contentType } : {})
        }
      })
    } catch (error) {
      return failure(error, 502)
    }
  }
}
