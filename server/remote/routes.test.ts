import { expect, test } from 'bun:test'
import { allowedCloudRequest, cloudRoutes } from './routes'

const workspace = { user_id: 'owner', workspace_id: 'board' }

test('every path a route builds is allowed for each of its methods', () => {
  const {
    files,
    scratchpadAsset,
    acceptInvitation,
    workspace: ownedWorkspace,
    ...rest
  } = cloudRoutes
  const built = [
    [files, files.path(workspace, 'assets/my photo (1).png')],
    [scratchpadAsset, scratchpadAsset.path(workspace, 'image 1.png')],
    [ownedWorkspace, ownedWorkspace.path('board')],
    [acceptInvitation, acceptInvitation.path('inv_1')],
    ...Object.values(rest).map(route => [route, route.path(workspace)] as const)
  ] as const
  for (const [route, path] of built)
    for (const method of route.methods)
      expect(allowedCloudRequest(method, path)).toEqual({
        access: route.access,
        ...(path.includes('owner:board') ? { workspace } : {})
      })
  expect(cloudRoutes.leave.access).toBe('own login')
  expect(() => files.path(workspace, '../secret')).toThrow()
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
    ['GET', '/api/me'],
    ['GET', 'https://evil.example/api/me']
  ] as const)
    expect(() => allowedCloudRequest(method, path)).toThrow('This Cloud request is not allowed')
})
