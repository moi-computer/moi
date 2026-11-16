import { expect, test } from 'bun:test'
import { allowedCloudRequest, cloudRoutes } from './routes'

const workspace = { user_id: 'owner', workspace_id: 'board' }

test('lists the requests the CLI makes and names their workspace', () => {
  for (const [method, path] of [
    ['GET', 'api/me'],
    ['PATCH', 'api/me'],
    ['GET', 'api/workspaces/shared'],
    ['GET', 'api/workspaces/invitations'],
    ['POST', 'api/invitations/inv_1/accept']
  ] as const)
    expect(allowedCloudRequest(method, path)).toEqual({})
  for (const [method, path] of [
    ['POST', 'api/workspaces/owner:board/leave'],
    ['POST', 'api/workspaces/owner:board/ops/exec'],
    ['POST', 'api/workspaces/owner:board/ops/commands'],
    ['GET', 'api/workspaces/owner:board/ops/files/notes.txt'],
    ['PUT', 'api/workspaces/owner:board/ops/files/assets/my%20photo.png'],
    ['PATCH', 'api/workspaces/owner:board/ops/files/notes.txt'],
    ['get', '/api/workspaces/owner:board/views?includePending=true'],
    ['PUT', '/api/workspaces/owner:board/config'],
    ['DELETE', '/api/workspaces/owner:board/icon'],
    ['GET', '/api/workspaces/owner:board/scratchpad'],
    ['POST', '/api/workspaces/owner:board/scratchpad/ops'],
    ['GET', '/api/workspaces/owner:board/scratchpad/assets/image.png']
  ] as const)
    expect(allowedCloudRequest(method, path)).toEqual({ workspace })
})

test('refuses everything else', () => {
  for (const [method, path] of [
    ['POST', 'api/cloud/dangerous-moi-action'],
    ['DELETE', 'api/me'],
    ['POST', 'api/agents/logout'],
    ['POST', 'api/auth/oauth2/token'],
    ['DELETE', 'api/workspaces/owner:board/ops/files/notes.txt'],
    ['GET', 'api/workspaces/owner:board/ops/exec'],
    ['POST', 'api/workspaces/owner:board/ops/exec/extra'],
    ['GET', 'api/workspaces/owner:board/ops/files/'],
    ['GET', 'api/workspaces/owner:board/ops/files/../../../me'],
    ['GET', 'api/workspaces/owner:board/ops/files/%2e%2e/secret'],
    ['GET', 'api/workspaces/owner:board/ops/files/a%2Fb'],
    ['GET', 'api/workspaces/owner:board/ops/files/a%5Cb'],
    ['GET', 'api/workspaces/owner:board/ops/files/%zz'],
    ['GET', 'api/workspaces/owner:board/ops/files/notes.txt?download=1'],
    ['GET', 'api/workspaces/owner:create/ops/files/notes.txt'],
    ['GET', 'api/workspaces/board/ops/files/notes.txt'],
    ['GET', '/api/workspaces/owner:board/views'],
    ['GET', '/api/workspaces/owner:board/views?includePending=true&x=1'],
    ['GET', '/api/workspaces/owner:board/widgets'],
    ['GET', '//evil.example/api/me'],
    ['GET', 'https://evil.example/api/me'],
    ['GET', '/api/me'],
    ['GET', 'api/me#x'],
    ['GET', '']
  ] as const)
    expect(() => allowedCloudRequest(method, path)).toThrow('This Cloud request is not allowed')
})

test('every path a route builds is allowed for each of its methods', () => {
  const values = { id: 'inv_1', workspace, file: 'assets/my photo (1).png', name: 'image 1.png' }
  for (const route of Object.values(cloudRoutes)) {
    const path = (route.path as (params: typeof values) => string)(values)
    for (const method of route.methods)
      expect(allowedCloudRequest(method, path)).toEqual(
        path.includes('owner:board') ? { workspace } : {}
      )
  }
})

test('builders refuse values that would change the path', () => {
  for (const file of ['', '/etc/passwd', '../secret', 'a//b', 'a/./b', 'a\\b'])
    expect(() => cloudRoutes.files.path({ workspace, file })).toThrow('relative to the remote')
  expect(() => cloudRoutes.scratchpadAsset.path({ workspace, name: 'a/b.png' })).toThrow()
  expect(() => cloudRoutes.acceptInvitation.path({ id: 'a/b' })).toThrow('Invalid invitation ID')
  expect(() =>
    cloudRoutes.leave.path({ workspace: { user_id: 'a/b', workspace_id: 'board' } })
  ).toThrow('Invalid remote owner ID')
})
