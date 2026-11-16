import { expect, test } from 'bun:test'
import { allowedCloudRequest, cloudRoutes } from './routes'

const workspace = { user_id: 'owner', workspace_id: 'board' }

test('every path a route builds is allowed for each of its methods', () => {
  const values = { id: 'inv_1', workspace, file: 'assets/my photo (1).png', name: 'image 1.png' }
  for (const route of Object.values(cloudRoutes)) {
    const path = (route.path as (params: typeof values) => string)(values)
    for (const method of route.methods)
      expect(allowedCloudRequest(method, path)).toEqual({
        access: route.access,
        ...(path.includes('owner:board') ? { workspace } : {})
      })
  }
  expect(cloudRoutes.leave.access).toBe('own login')
  expect(() => cloudRoutes.files.path({ workspace, file: '../secret' })).toThrow()
})

test('refuses unlisted requests and paths that would resolve elsewhere', () => {
  for (const [method, path] of [
    ['POST', 'api/cloud/dangerous-moi-action'],
    ['DELETE', 'api/me'],
    ['POST', 'api/agents/logout'],
    ['GET', 'api/workspaces/owner:board/ops/files/../../../me'],
    ['GET', 'api/workspaces/owner:board/ops/files/%2e%2e/secret'],
    ['GET', 'api/workspaces/owner:board/ops/files/a%2Fb'],
    ['GET', '/api/workspaces/owner:board/widgets'],
    ['GET', 'https://evil.example/api/me']
  ] as const)
    expect(() => allowedCloudRequest(method, path)).toThrow('This Cloud request is not allowed')
})
