import { afterEach, expect, spyOn, test } from 'bun:test'
import * as client from '../remote/client'
import { requestWorkspace } from './api'

const path = '/api/workspaces/alice:board/config'
let request: ReturnType<typeof spyOn<typeof client, 'remoteRequest'>>
afterEach(() => request?.mockRestore())

test('forwards the path, request bytes, and cancellation', async () => {
  request = spyOn(client, 'remoteRequest').mockResolvedValue(new Response('result'))
  const signal = new AbortController().signal
  const response = await requestWorkspace(path, {
    method: 'POST',
    body: 'payload',
    signal,
    headers: { 'content-type': 'application/json' }
  })
  expect(await response.text()).toBe('result')
  expect(request).toHaveBeenCalledWith(path, {
    method: 'POST',
    body: new TextEncoder().encode('payload'),
    signal,
    contentType: 'application/json'
  })
})

test('multipart upload preserves its boundary and bytes', async () => {
  request = spyOn(client, 'remoteRequest').mockResolvedValue(new Response(null, { status: 204 }))
  const body = new FormData()
  body.set('image', new Blob([new Uint8Array([0, 255, 1])]), 'image.bin')
  await requestWorkspace(path, { method: 'PUT', body })
  const options = request.mock.calls[0]![1]!
  const received = await new Response(options.body, {
    headers: { 'content-type': options.contentType! }
  }).formData()
  const image = received.get('image') as File
  expect(image.name).toBe('image.bin')
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1]))
})
