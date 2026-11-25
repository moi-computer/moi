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

type Seen = {
  method: string
  path: string
  authorization: string | null
  body: string
  length: string | null
}
let serverDirectory: string
let callerDirectory: string
let cloud: ReturnType<typeof Bun.serve>
let moi: ReturnType<typeof Bun.serve>
let seen: Seen[]
let caller: ReturnType<typeof createRemoteClient>
const jwt = (name: string) =>
  `e30.${Buffer.from(JSON.stringify({ exp: 4102444800, name })).toString('base64url')}.signature`
const cloudUrl = () => cloud.url.origin + '/cloud'
const linked = [
  { id: 'w1', path: '/workspaces/board', remote: { user_id: 'owner', workspace_id: 'board' } }
] as WorkspaceEntry[]
const board = { user_id: 'owner', workspace_id: 'board' }
const file = (name: string, workspace = board) => cloudRoutes.files.path(workspace, name)

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
  cloud = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname + url.search
      const body = await request.text()
      seen.push({
        method: request.method,
        path,
        authorization: request.headers.get('authorization'),
        body: body.length > 1000 ? '' : body,
        length: request.headers.get('content-length')
      })
      if (path === '/cloud/api/me')
        return Response.json({ id: 'u1', name: 'Owner', email: 'owner@example.com' })
      if (path === '/cloud/api/workspaces/remote') return Response.json({ workspaces: [] })
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
  const bytes = new Uint8Array(20 * 1024 * 1024)
  const uploaded = await caller.remoteRequest(file('assets/big.bin'), {
    method: 'PUT',
    body: new Blob([bytes]),
    contentType: 'application/octet-stream'
  })
  expect((await uploaded.arrayBuffer()).byteLength).toBe(bytes.byteLength)
  expect(seen.at(-1)).toMatchObject({
    method: 'PUT',
    path: '/cloud/api/workspaces/owner:board/ops/files/assets/big.bin',
    length: String(bytes.byteLength)
  })
  expect(new Set(seen.map(request => request.authorization))).toEqual(
    new Set([`Bearer ${jwt('server')}`])
  )
  expect(await readdir(callerDirectory)).toEqual([])
})

test('the server refuses unlisted requests, account changes, unlinked workspaces, and web pages', async () => {
  const ask = (path: string, init: RequestInit = {}) =>
    fetch(`${moi.url.origin}/remote/request?path=${encodeURIComponent(path)}`, {
      ...init,
      headers: { [BROKER_CALLER_HEADER]: '1', ...init.headers }
    })
  const error = async (response: Response) => ((await response.json()) as { error: string }).error
  expect(await error(await ask('api/cloud/dangerous-moi-action', { method: 'POST' }))).toBe(
    'This Cloud request is not allowed'
  )
  expect(await error(await ask('api/invitations/inv_1/accept', { method: 'POST' }))).toBe(
    'This request needs your own Cloud login'
  )
  await expect(
    caller.remoteRequest(file('notes.txt', { user_id: 'owner', workspace_id: 'other' }))
  ).rejects.toThrow('This workspace is not linked on this machine')
  expect((await ask('api/me', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
  expect((await fetch(`${moi.url.origin}/remote/request?path=api%2Fme`)).status).toBe(403)
  expect(seen).toEqual([])
})

test('a caller with its own login uses it and never asks the server', async () => {
  await signIn(callerDirectory, 'caller')
  expect((await caller.remoteStatus()).me.id).toBe('u1')
  expect(new Set(seen.map(request => request.authorization))).toEqual(
    new Set([`Bearer ${jwt('caller')}`])
  )
})

test('with no server running the caller is signed out', async () => {
  await Bun.write(
    join(callerDirectory, 'config.json'),
    JSON.stringify({ remote: { url: cloudUrl() } })
  )
  moi.stop(true)
  await expect(caller.remoteStatus()).rejects.toBeInstanceOf(CloudSignInRequired)
  await expect(caller.leave('owner', 'board')).rejects.toBeInstanceOf(CloudSignInRequired)
  expect(seen).toEqual([])
})
