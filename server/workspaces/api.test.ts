import { afterEach, expect, spyOn, test } from 'bun:test'
import * as client from '../remote/client'
import { requestWorkspace } from './api'

const target = { remote: { user_id: 'alice', workspace_id: 'board' } }
let request: ReturnType<typeof spyOn<typeof client, 'workspaceRequest'>>
afterEach(() => request?.mockRestore())

test('forwards the owner address, request bytes, and cancellation', async () => {
  request = spyOn(client, 'workspaceRequest').mockResolvedValue(new Response('result'))
  const signal = new AbortController().signal
  const response = await requestWorkspace(target, '/rpc/views/counter/increment', {
    method: 'POST',
    body: 'payload',
    signal,
    headers: { 'content-type': 'application/json' }
  })
  expect(await response.text()).toBe('result')
  expect(request).toHaveBeenCalledWith('alice', 'board', '/rpc/views/counter/increment', {
    method: 'POST',
    body: new TextEncoder().encode('payload'),
    signal,
    contentType: 'application/json'
  })
})

test('multipart upload preserves its boundary and bytes', async () => {
  request = spyOn(client, 'workspaceRequest').mockResolvedValue(new Response(null, { status: 204 }))
  const body = new FormData()
  body.set('image', new Blob([new Uint8Array([0, 255, 1])]), 'image.bin')
  await requestWorkspace(target, '/config/icon', { method: 'PUT', body })
  const options = request.mock.calls[0]![3]!
  const received = await new Response(options.body, {
    headers: { 'content-type': options.contentType! }
  }).formData()
  const image = received.get('image') as File
  expect(image.name).toBe('image.bin')
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1]))
})
