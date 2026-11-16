import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceEntry } from '@/lib/types'
import { createRemoteBroker } from './broker'
import { BROKER_CALLER_HEADER, createControlBroker } from './broker-client'
import { CloudSignInRequired, createRemoteClient } from './client'
import { cloudRoutes } from './routes'

// A Moi server signed in to Cloud, and a caller on the same machine that has
// its own, empty data directory: the agent's OS user on a managed machine.

type Seen = { method: string; path: string; authorization: string | null; body: string }
let serverDirectory: string
let callerDirectory: string
let cloud: ReturnType<typeof Bun.serve>
let moi: ReturnType<typeof Bun.serve>
let seen: Seen[]
let execAborted: Promise<void>
let caller: ReturnType<typeof createRemoteClient>
const jwt = (name: string) =>
  `e30.${Buffer.from(JSON.stringify({ exp: 4102444800, name })).toString('base64url')}.signature`
const cloudUrl = () => cloud.url.origin + '/cloud'
const linked = [
  { id: 'w1', path: '/workspaces/board', remote: { user_id: 'owner', workspace_id: 'board' } }
] as WorkspaceEntry[]
const board = { user_id: 'owner', workspace_id: 'board' }
const file = (name: string, workspace = board) => cloudRoutes.files.path({ workspace, file: name })

async function signIn(directory: string, name: string) {
  await Bun.write(join(directory, 'config.json'), JSON.stringify({ remote: { url: cloudUrl() } }))
  await Bun.write(
    join(directory, 'remote-auth.json'),
    JSON.stringify({
      accessToken: jwt(name),
      refreshToken: 'refresh',
      url: cloudUrl(),
      clientId: 'moi-cli'
    })
  )
}

beforeEach(async () => {
  serverDirectory = await mkdtemp(join(tmpdir(), 'moi-broker-server-'))
  callerDirectory = await mkdtemp(join(tmpdir(), 'moi-broker-caller-'))
  seen = []
  const aborted = Promise.withResolvers<void>()
  execAborted = aborted.promise
  cloud = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname + url.search
      if (path.endsWith('/ops/exec')) {
        request.signal.addEventListener('abort', () => aborted.resolve())
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"type":"stdout","data":"hi"}\n'))
            }
          })
        )
      }
      const body = await request.text()
      seen.push({
        method: request.method,
        path,
        authorization: request.headers.get('authorization'),
        body
      })
      if (path === '/cloud/api/me')
        return Response.json({ id: 'u1', name: 'Owner', email: 'owner@example.com' })
      if (path === '/cloud/api/workspaces/shared') return Response.json({ workspaces: [] })
      if (path === '/cloud/api/invitations/inv_1/accept')
        return Response.json({
          success: true,
          remote: { user_id: 'owner', workspace_id: 'board' },
          membershipId: 'm1'
        })
      if (path === '/cloud/api/workspaces/owner:board/ops/files/missing.txt')
        return new Response(null, { status: 404 })
      return new Response(body || 'file bytes', {
        headers: { 'content-type': request.headers.get('content-type') ?? 'text/plain' }
      })
    }
  })
  await signIn(serverDirectory, 'server')
  const broker = createRemoteBroker(createRemoteClient(serverDirectory), async () => linked)
  moi = Bun.serve({
    port: 0,
    async fetch(request, server) {
      server.timeout(request, 0)
      return (await broker(request)) ?? new Response('Control WebSocket only', { status: 426 })
    }
  })
  caller = createRemoteClient(callerDirectory, createControlBroker(moi.url.origin))
})
afterEach(async () => {
  moi.stop(true)
  cloud.stop(true)
  await rm(serverDirectory, { recursive: true, force: true })
  await rm(callerDirectory, { recursive: true, force: true })
})

test('a caller with no login reaches Cloud through the server and never holds a credential', async () => {
  expect((await caller.remoteStatus()).me.id).toBe('u1')
  expect(await caller.cloudUrl()).toBe(cloudUrl())
  expect(seen.map(request => request.authorization)).toEqual(
    seen.map(() => `Bearer ${jwt('server')}`)
  )
  expect(seen.map(request => request.path).sort()).toEqual([
    '/cloud/api/me',
    '/cloud/api/workspaces/shared'
  ])
  expect(await readdir(callerDirectory)).toEqual([])
})

test('uploads, downloads, and workspace API calls keep their bytes, type, and status', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(200_000))
  const uploaded = await caller.remoteRequest(file('assets/photo.bin'), {
    method: 'PUT',
    body: new Blob([bytes]),
    contentType: 'application/octet-stream'
  })
  expect(uploaded.headers.get('content-type')).toBe('application/octet-stream')
  expect((await uploaded.arrayBuffer()).byteLength).toBeGreaterThan(0)
  expect(seen[0]).toMatchObject({
    method: 'PUT',
    path: '/cloud/api/workspaces/owner:board/ops/files/assets/photo.bin'
  })
  expect(await (await caller.remoteRequest(file('notes.txt'))).text()).toBe('file bytes')
  await caller.remoteRequest(cloudRoutes.config.path({ workspace: board }), {
    method: 'PUT',
    body: '{"name":"Board"}',
    contentType: 'application/json'
  })
  expect(seen.at(-1)).toMatchObject({
    method: 'PUT',
    path: '/api/workspaces/owner:board/config',
    body: '{"name":"Board"}'
  })
  await expect(caller.remoteRequest(file('missing.txt'))).rejects.toThrow(
    'Remote operation failed (404)'
  )
})

test('cancelling a streamed command reaches Cloud', async () => {
  const controller = new AbortController()
  const response = await caller.remoteRequest(cloudRoutes.exec.path({ workspace: board }), {
    method: 'POST',
    body: '{"command":"sleep 60"}',
    contentType: 'application/json',
    signal: controller.signal
  })
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"hi"')
  controller.abort()
  await execAborted
})

test('the server refuses unlisted requests, unlinked workspaces, and web pages', async () => {
  const ask = (path: string, init: RequestInit = {}) =>
    fetch(`${moi.url.origin}/remote/request?path=${encodeURIComponent(path)}`, {
      ...init,
      headers: { [BROKER_CALLER_HEADER]: '1', ...init.headers }
    })
  for (const [path, method] of [
    ['api/cloud/dangerous-moi-action', 'POST'],
    ['api/agents/logout', 'POST'],
    ['api/workspaces/owner:board/ops/files/%2e%2e/secret', 'GET'],
    ['https://evil.example/api/me', 'GET']
  ] as const) {
    const refused = await ask(path, { method })
    expect(refused.status).toBe(502)
    expect(await refused.json()).toMatchObject({ error: 'This Cloud request is not allowed' })
  }
  await expect(
    caller.remoteRequest(file('notes.txt', { user_id: 'owner', workspace_id: 'other' }))
  ).rejects.toThrow('This workspace is not linked on this machine')
  expect((await ask('api/me', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
  expect(
    (await fetch(`${moi.url.origin}/remote/request?path=api%2Fme`, { method: 'POST' })).status
  ).toBe(403)
  expect((await fetch(`${moi.url.origin}/remote/info`)).status).toBe(403)
  expect(seen).toEqual([])
})

test('a caller with its own login uses it and never asks the server', async () => {
  await signIn(callerDirectory, 'caller')
  expect((await caller.remoteStatus()).me.id).toBe('u1')
  expect(new Set(seen.map(request => request.authorization))).toEqual(
    new Set([`Bearer ${jwt('caller')}`])
  )
})

test('with no server running, or one that predates the broker, the caller is signed out', async () => {
  await Bun.write(
    join(callerDirectory, 'config.json'),
    JSON.stringify({ remote: { url: cloudUrl() } })
  )
  const predates = Bun.serve({
    port: 0,
    fetch: () => new Response('Control WebSocket only', { status: 426 })
  })
  const origin = predates.url.origin
  try {
    await expect(
      createRemoteClient(callerDirectory, createControlBroker(origin)).remoteStatus()
    ).rejects.toBeInstanceOf(CloudSignInRequired)
  } finally {
    predates.stop(true)
  }
  await expect(
    createRemoteClient(callerDirectory, createControlBroker(origin)).remoteStatus()
  ).rejects.toBeInstanceOf(CloudSignInRequired)
  expect(seen).toEqual([])
})

test('a server that is signed out says so', async () => {
  await rm(join(serverDirectory, 'remote-auth.json'))
  await expect(caller.remoteStatus()).rejects.toBeInstanceOf(CloudSignInRequired)
})

test('invitations are accepted with the server login; a human login refuses agent invites', async () => {
  expect((await caller.accept('inv_1')).remote).toEqual({
    user_id: 'owner',
    workspace_id: 'board'
  })
  expect(seen[0]).toMatchObject({ method: 'POST', path: '/cloud/api/invitations/inv_1/accept' })
  await expect(
    caller.accept(`${cloudUrl()}/agent-invite/inv_2?token=${'A'.repeat(43)}`)
  ).rejects.toThrow('Already signed in as a human')
  await expect(caller.renameAgent('Lawyer')).rejects.toThrow('This command is for agents')
  expect(seen).toHaveLength(1)
})
